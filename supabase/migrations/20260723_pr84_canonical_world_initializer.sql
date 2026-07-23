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

  insert into public.canonical_world_saves
  select (jsonb_populate_record(null::public.canonical_world_saves, p_save)).*;

  insert into public.persistent_world_backups
  select (jsonb_populate_record(null::public.persistent_world_backups, p_backup)).*;

  insert into public.world_operation_events
  select (jsonb_populate_record(null::public.world_operation_events, p_event)).*;

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
