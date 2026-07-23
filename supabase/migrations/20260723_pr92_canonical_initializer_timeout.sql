-- PR #92: initialize large canonical worlds without duplicating the save payload through PostgREST.
--
-- The published 80-club world produces a large JSONB save envelope. PR #84 passed that
-- envelope twice (once in p_save and again inside p_backup), then inserted both copies in
-- one statement subject to the normal short API statement timeout. This replacement keeps
-- the operation atomic but derives the opening backup from the newly inserted canonical row.

create or replace function public.initialize_canonical_world(
  p_save jsonb,
  p_backup jsonb,
  p_event jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
set statement_timeout = '60s'
as $$
declare
  v_world_id text := p_save->>'world_id';
begin
  if v_world_id is null or btrim(v_world_id) = '' then
    raise exception 'Canonical world ID is required';
  end if;
  if exists (select 1 from public.canonical_world_saves where world_id = v_world_id) then
    raise exception 'Canonical world % has already been initialized', v_world_id;
  end if;

  insert into public.canonical_world_saves (
    world_id, save_version, save_checksum, save_envelope, season_id, season_number,
    phase, matchday, next_turn_at, turn_status, created_at, updated_at
  ) values (
    p_save->>'world_id', p_save->>'save_version', p_save->>'save_checksum', p_save->'save_envelope',
    p_save->>'season_id', nullif(p_save->>'season_number', '')::integer, p_save->>'phase',
    nullif(p_save->>'matchday', '')::integer, nullif(p_save->>'next_turn_at', '')::timestamptz,
    p_save->>'turn_status', nullif(p_save->>'created_at', '')::timestamptz,
    nullif(p_save->>'updated_at', '')::timestamptz
  );

  insert into public.persistent_world_backups (
    backup_id, world_id, manager_id, club_id, save_version, save_checksum, save_envelope,
    source_save_updated_at, source, reason, season_id, season_number, phase, matchday,
    created_by, created_at, restored_at, restored_by
  )
  select
    p_backup->>'backup_id', c.world_id, nullif(p_backup->>'manager_id', '')::uuid,
    p_backup->>'club_id', c.save_version, c.save_checksum, c.save_envelope,
    c.updated_at, p_backup->>'source', p_backup->>'reason', c.season_id, c.season_number,
    c.phase, c.matchday, nullif(p_backup->>'created_by', '')::uuid,
    nullif(p_backup->>'created_at', '')::timestamptz,
    nullif(p_backup->>'restored_at', '')::timestamptz,
    nullif(p_backup->>'restored_by', '')::uuid
  from public.canonical_world_saves c
  where c.world_id = v_world_id;

  insert into public.world_operation_events (
    operation_id, operation_type, world_id, manager_id, club_id, source_backup_id,
    previous_checksum, replacement_checksum, status, details, requested_by, created_at
  ) values (
    p_event->>'operation_id', p_event->>'operation_type', p_event->>'world_id',
    nullif(p_event->>'manager_id', '')::uuid, p_event->>'club_id', p_event->>'source_backup_id',
    p_event->>'previous_checksum', p_event->>'replacement_checksum', p_event->>'status',
    coalesce(p_event->'details', '{}'::jsonb), nullif(p_event->>'requested_by', '')::uuid,
    nullif(p_event->>'created_at', '')::timestamptz
  );

  return jsonb_build_object(
    'accepted', true,
    'world_id', v_world_id,
    'save_checksum', p_save->>'save_checksum',
    'backup_id', p_backup->>'backup_id',
    'operation_id', p_event->>'operation_id'
  );
end;
$$;

revoke all on function public.initialize_canonical_world(jsonb, jsonb, jsonb) from public;
revoke all on function public.initialize_canonical_world(jsonb, jsonb, jsonb) from anon;
revoke all on function public.initialize_canonical_world(jsonb, jsonb, jsonb) from authenticated;
grant execute on function public.initialize_canonical_world(jsonb, jsonb, jsonb) to service_role;
