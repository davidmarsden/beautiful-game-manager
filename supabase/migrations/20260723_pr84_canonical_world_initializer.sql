-- PR #84: admin-only initialization of the first canonical shared world.

-- Replace the operational event constraint so initialization has its own audit identity.
do $$
declare
  constraint_name text;
begin
  if to_regclass('public.world_operation_events') is not null then
    select conname into constraint_name
    from pg_constraint
    where conrelid = 'public.world_operation_events'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%operation_type%';
    if constraint_name is not null then
      execute format('alter table public.world_operation_events drop constraint %I', constraint_name);
    end if;
    alter table public.world_operation_events
      add constraint world_operation_events_operation_type_check
      check (operation_type in ('initialize','backup','restore','rollback','reset','monitor'));
  end if;
end $$;

-- One service-role RPC writes the canonical save, opening backup and audit event in one transaction.
create or replace function public.initialize_canonical_world(
  p_save jsonb,
  p_backup jsonb,
  p_event jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
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
  ) values (
    p_backup->>'backup_id', p_backup->>'world_id', nullif(p_backup->>'manager_id', '')::uuid,
    p_backup->>'club_id', p_backup->>'save_version', p_backup->>'save_checksum', p_backup->'save_envelope',
    nullif(p_backup->>'source_save_updated_at', '')::timestamptz, p_backup->>'source', p_backup->>'reason',
    p_backup->>'season_id', nullif(p_backup->>'season_number', '')::integer, p_backup->>'phase',
    nullif(p_backup->>'matchday', '')::integer, nullif(p_backup->>'created_by', '')::uuid,
    nullif(p_backup->>'created_at', '')::timestamptz, nullif(p_backup->>'restored_at', '')::timestamptz,
    nullif(p_backup->>'restored_by', '')::uuid
  );

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

-- Retire the internal setup token from the manager-facing world record.
update public.worlds
set status = 'active', updated_at = now()
where status = 'inaugural_divisions_seeded';
