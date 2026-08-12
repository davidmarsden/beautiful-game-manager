-- Issue #211: allow the service-role-only stale-turn recovery RPC to work
-- with modern Supabase secret keys as well as legacy JWT service-role keys.
--
-- EXECUTE privilege is the security boundary. The previous function also
-- required request.jwt.claim.role = service_role, which is not populated when
-- PostgREST authenticates a modern sb_secret_* service key. That caused every
-- scheduled watchdog recovery to fail with "service role required" despite the
-- caller already holding the service_role database privilege.

create or replace function public.recover_stale_canonical_turn_lock(
  p_world_id text,
  p_expected_checksum text,
  p_expected_updated_at timestamptz,
  p_requested_by uuid,
  p_now timestamptz default now(),
  p_lease interval default interval '20 minutes'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_world public.canonical_world_saves%rowtype;
  v_run public.world_turn_runs%rowtype;
  v_reason text;
  v_age interval;
  v_reopened integer := 0;
  v_failed_runs uuid[] := '{}';
  v_synthetic boolean := false;
begin
  select * into v_world
  from public.canonical_world_saves
  where world_id = p_world_id
  for update;

  if not found then
    return jsonb_build_object('recovered', false, 'reason', 'world_not_found');
  end if;

  if v_world.turn_status <> 'locking' then
    return jsonb_build_object(
      'recovered', false,
      'reason', 'not_locking',
      'turn_status', v_world.turn_status,
      'checksum', v_world.save_checksum,
      'updated_at', v_world.updated_at
    );
  end if;

  if v_world.save_checksum <> p_expected_checksum or v_world.updated_at <> p_expected_updated_at then
    return jsonb_build_object(
      'recovered', false,
      'reason', 'checkpoint_changed',
      'turn_status', v_world.turn_status,
      'checksum', v_world.save_checksum,
      'updated_at', v_world.updated_at
    );
  end if;

  v_age := p_now - v_world.updated_at;
  if v_age < p_lease then
    return jsonb_build_object(
      'recovered', false,
      'reason', 'lease_active',
      'lock_age_ms', floor(extract(epoch from v_age) * 1000),
      'turn_status', v_world.turn_status,
      'checksum', v_world.save_checksum,
      'updated_at', v_world.updated_at
    );
  end if;

  v_reason := format(
    'Abandoned canonical turn lock recovered after %s minutes',
    floor(extract(epoch from v_age) / 60)
  );

  update public.manager_turn_submissions
  set status = 'submitted', locked_at = null
  where world_id = v_world.world_id
    and season_id = v_world.season_id
    and matchday = v_world.matchday
    and status = 'locked';
  get diagnostics v_reopened = row_count;

  for v_run in
    update public.world_turn_runs
    set status = 'failed', error_message = v_reason, completed_at = p_now
    where world_id = v_world.world_id
      and previous_checksum = v_world.save_checksum
      and status = 'processing'
    returning *
  loop
    v_failed_runs := array_append(v_failed_runs, v_run.id);
  end loop;

  if cardinality(v_failed_runs) = 0 then
    select * into v_run
    from public.world_turn_runs
    where world_id = v_world.world_id
      and season_id = v_world.season_id
      and matchday = v_world.matchday
    limit 1;

    if found then
      if v_run.status <> 'failed' then
        update public.world_turn_runs
        set status = 'failed', error_message = v_reason, completed_at = p_now
        where id = v_run.id
        returning * into v_run;
      end if;
    else
      insert into public.world_turn_runs (
        world_id, season_id, matchday, previous_checksum, scheduled_for,
        started_at, completed_at, status, submission_count, fallback_count,
        error_message
      ) values (
        v_world.world_id,
        coalesce(v_world.season_id, 'unknown'),
        coalesce(v_world.matchday, 1),
        v_world.save_checksum,
        coalesce(v_world.next_turn_at, v_world.updated_at, p_now),
        v_world.updated_at,
        p_now,
        'failed',
        0,
        0,
        v_reason
      ) returning * into v_run;
      v_synthetic := true;
    end if;

    v_failed_runs := array_append(v_failed_runs, v_run.id);
  end if;

  update public.canonical_world_saves
  set turn_status = 'failed', updated_at = p_now
  where world_id = v_world.world_id;

  insert into public.world_operation_events (
    operation_id, operation_type, world_id, manager_id, club_id,
    previous_checksum, replacement_checksum, status, details,
    requested_by, created_at
  ) values (
    format('stale-turn-lock-recovery:%s:%s:%s', v_world.world_id, v_world.save_checksum, p_now),
    'advance',
    v_world.world_id,
    null,
    null,
    v_world.save_checksum,
    null,
    'rejected',
    jsonb_build_object(
      'action', 'recover_abandoned_turn_lock',
      'error', v_reason,
      'diagnostics', jsonb_build_object(
        'failing_stage', 'abandoned_lock',
        'lock_age_ms', floor(extract(epoch from v_age) * 1000),
        'processing_run_ids', to_jsonb(v_failed_runs),
        'synthetic_failed_run', v_synthetic,
        'submissions_reopened', v_reopened
      ),
      'before', jsonb_build_object(
        'turn_status', 'locking',
        'updated_at', v_world.updated_at,
        'checksum', v_world.save_checksum
      )
    ),
    p_requested_by,
    p_now
  );

  return jsonb_build_object(
    'recovered', true,
    'reason', v_reason,
    'world_id', v_world.world_id,
    'checksum', v_world.save_checksum,
    'turn_status', 'failed',
    'updated_at', p_now,
    'failed_run_id', v_failed_runs[1],
    'failed_run_ids', to_jsonb(v_failed_runs),
    'synthetic_failed_run', v_synthetic,
    'submissions_reopened', v_reopened
  );
end;
$$;

revoke all on function public.recover_stale_canonical_turn_lock(text, text, timestamptz, uuid, timestamptz, interval) from public;
revoke all on function public.recover_stale_canonical_turn_lock(text, text, timestamptz, uuid, timestamptz, interval) from anon;
revoke all on function public.recover_stale_canonical_turn_lock(text, text, timestamptz, uuid, timestamptz, interval) from authenticated;
grant execute on function public.recover_stale_canonical_turn_lock(text, text, timestamptz, uuid, timestamptz, interval) to service_role;
