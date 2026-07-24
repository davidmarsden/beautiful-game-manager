-- PR #105: permit immutable audit events and atomically apply checksum-protected canonical registration repair.

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
      check (operation_type in ('initialize','backup','restore','rollback','reset','monitor','advance','registration_repair'));
  end if;
end $$;

create or replace function public.apply_canonical_registration_repair(
  p_world_id text,
  p_expected_checksum text,
  p_expected_turn_status text,
  p_replacement jsonb,
  p_operation jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_row public.canonical_world_saves%rowtype;
  operation_id_value text := p_operation->>'operation_id';
begin
  if exists (
    select 1 from public.world_operation_events
    where operation_id = operation_id_value
  ) then
    return jsonb_build_object('accepted', false, 'reason', 'duplicate_operation');
  end if;

  update public.canonical_world_saves
  set save_version = p_replacement->>'save_version',
      save_checksum = p_replacement->>'save_checksum',
      save_envelope = p_replacement->'save_envelope',
      season_id = p_replacement->>'season_id',
      season_number = nullif(p_replacement->>'season_number', '')::integer,
      phase = p_replacement->>'phase',
      matchday = nullif(p_replacement->>'matchday', '')::integer,
      next_turn_at = nullif(p_replacement->>'next_turn_at', '')::timestamptz,
      turn_status = p_replacement->>'turn_status',
      updated_at = nullif(p_replacement->>'updated_at', '')::timestamptz
  where world_id = p_world_id
    and save_checksum = p_expected_checksum
    and turn_status = p_expected_turn_status
  returning * into updated_row;

  if not found then
    return jsonb_build_object('accepted', false, 'reason', 'checkpoint_changed');
  end if;

  insert into public.world_operation_events (
    operation_id,
    operation_type,
    world_id,
    manager_id,
    club_id,
    previous_checksum,
    replacement_checksum,
    status,
    details,
    requested_by,
    created_at
  ) values (
    operation_id_value,
    p_operation->>'operation_type',
    p_operation->>'world_id',
    nullif(p_operation->>'manager_id', '')::uuid,
    nullif(p_operation->>'club_id', ''),
    p_operation->>'previous_checksum',
    p_operation->>'replacement_checksum',
    p_operation->>'status',
    coalesce(p_operation->'details', '{}'::jsonb),
    nullif(p_operation->>'requested_by', '')::uuid,
    nullif(p_operation->>'created_at', '')::timestamptz
  );

  return jsonb_build_object(
    'accepted', true,
    'world_id', updated_row.world_id,
    'save_checksum', updated_row.save_checksum,
    'turn_status', updated_row.turn_status
  );
end;
$$;

revoke all on function public.apply_canonical_registration_repair(text,text,text,jsonb,jsonb) from public;
revoke all on function public.apply_canonical_registration_repair(text,text,text,jsonb,jsonb) from anon;
revoke all on function public.apply_canonical_registration_repair(text,text,text,jsonb,jsonb) from authenticated;
grant execute on function public.apply_canonical_registration_repair(text,text,text,jsonb,jsonb) to service_role;
