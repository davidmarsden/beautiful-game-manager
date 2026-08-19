-- #240 Slice D: CAS-safe one-party free-agent acquisition and durable history.

begin;

create table if not exists public.player_acquisitions (
  id uuid primary key default gen_random_uuid(),
  world_id text not null,
  manager_id uuid not null references public.manager_profiles(id) on delete cascade,
  club_id text not null,
  acquisition_type text not null default 'free_agent' check (acquisition_type in ('free_agent','external')),
  player_id text not null,
  transfermarkt_id text,
  player_name text not null,
  player_snapshot jsonb not null default '{}'::jsonb,
  contract_years integer not null default 3 check (contract_years between 1 and 5),
  wage bigint not null default 1000 check (wage >= 0),
  status text not null default 'pending' check (status in ('pending','completed','application_failed')),
  request_key text not null,
  previous_checksum text,
  replacement_checksum text,
  application_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  terminal_at timestamptz
);

create unique index if not exists player_acquisitions_request_key_uidx
  on public.player_acquisitions(world_id, manager_id, request_key);
create unique index if not exists player_acquisitions_completed_player_uidx
  on public.player_acquisitions(world_id, player_id)
  where status = 'completed';
create index if not exists player_acquisitions_manager_history_idx
  on public.player_acquisitions(world_id, manager_id, created_at desc);

alter table public.player_acquisitions enable row level security;
revoke all on public.player_acquisitions from public, anon, authenticated;
grant select, insert, update on public.player_acquisitions to service_role;

create or replace function public.create_free_agent_acquisition_for_user(
  p_user_id uuid,
  p_world_id text,
  p_player_id text,
  p_transfermarkt_id text,
  p_player_name text,
  p_player_snapshot jsonb,
  p_contract_years integer,
  p_wage bigint,
  p_request_key text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  manager_id_value uuid;
  club_id_value text;
  row_value public.player_acquisitions;
  completed_value public.player_acquisitions;
begin
  if trim(coalesce(p_world_id, '')) = '' then raise exception 'World is required'; end if;
  if trim(coalesce(p_player_id, '')) = '' then raise exception 'Player is required'; end if;
  if trim(coalesce(p_player_name, '')) = '' then raise exception 'Player name is required'; end if;
  if trim(coalesce(p_request_key, '')) = '' then raise exception 'Request key is required'; end if;
  if coalesce(p_contract_years, 3) < 1 or coalesce(p_contract_years, 3) > 5 then raise exception 'Contract length must be between 1 and 5 seasons'; end if;
  if coalesce(p_wage, 0) < 0 then raise exception 'Wage cannot be negative'; end if;

  select profile.id, appointment.club_id
    into manager_id_value, club_id_value
  from public.manager_profiles profile
  join public.manager_appointments appointment
    on appointment.manager_id = profile.id
   and appointment.world_id = p_world_id
   and appointment.status = 'active'
  where profile.user_id = p_user_id
  limit 1;
  if manager_id_value is null or club_id_value is null then raise exception 'No active manager appointment for this user and world'; end if;

  select * into completed_value
  from public.player_acquisitions
  where world_id = p_world_id and player_id = p_player_id and status = 'completed'
  limit 1;
  if completed_value.id is not null then
    return jsonb_build_object(
      'accepted', false,
      'reason', 'player_already_acquired',
      'acquisition_id', completed_value.id,
      'club_id', completed_value.club_id,
      'status', completed_value.status,
      'replacement_checksum', completed_value.replacement_checksum
    );
  end if;

  insert into public.player_acquisitions(
    world_id, manager_id, club_id, acquisition_type, player_id, transfermarkt_id,
    player_name, player_snapshot, contract_years, wage, status, request_key
  ) values (
    p_world_id, manager_id_value, club_id_value, 'free_agent', p_player_id,
    nullif(trim(coalesce(p_transfermarkt_id, '')), ''), p_player_name,
    coalesce(p_player_snapshot, '{}'::jsonb), greatest(1, least(coalesce(p_contract_years, 3), 5)),
    greatest(coalesce(p_wage, 1000), 0), 'pending', p_request_key
  )
  on conflict (world_id, manager_id, request_key) do nothing
  returning * into row_value;

  if row_value.id is null then
    select * into row_value
    from public.player_acquisitions
    where world_id = p_world_id and manager_id = manager_id_value and request_key = p_request_key
    limit 1;
  end if;

  return jsonb_build_object(
    'accepted', true,
    'acquisition_id', row_value.id,
    'world_id', row_value.world_id,
    'manager_id', row_value.manager_id,
    'club_id', row_value.club_id,
    'player_id', row_value.player_id,
    'transfermarkt_id', row_value.transfermarkt_id,
    'player_name', row_value.player_name,
    'contract_years', row_value.contract_years,
    'wage', row_value.wage,
    'status', row_value.status,
    'previous_checksum', row_value.previous_checksum,
    'replacement_checksum', row_value.replacement_checksum,
    'application_error', row_value.application_error
  );
end;
$$;

create or replace function public.apply_free_agent_acquisition_settlement(
  p_acquisition_id uuid,
  p_expected_checksum text,
  p_replacement jsonb
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  acquisition_row public.player_acquisitions;
  world_row public.canonical_world_saves;
  replacement_checksum text := p_replacement->>'save_checksum';
  replacement_read_model jsonb := p_replacement->'read_model';
begin
  if p_acquisition_id is null then raise exception 'Acquisition is required'; end if;
  if trim(coalesce(p_expected_checksum, '')) = '' then raise exception 'Expected canonical checksum is required'; end if;
  if trim(coalesce(replacement_checksum, '')) = '' then raise exception 'Replacement checksum is required'; end if;
  if replacement_read_model is null or jsonb_typeof(replacement_read_model) <> 'object' then raise exception 'Compact replacement read model is required'; end if;

  select * into acquisition_row
  from public.player_acquisitions
  where id = p_acquisition_id
  for update;
  if acquisition_row.id is null then return jsonb_build_object('accepted', false, 'reason', 'acquisition_not_found'); end if;
  if acquisition_row.status = 'completed' then
    return jsonb_build_object(
      'accepted', acquisition_row.replacement_checksum = replacement_checksum,
      'reason', 'already_completed',
      'acquisition_id', acquisition_row.id,
      'replacement_checksum', acquisition_row.replacement_checksum
    );
  end if;
  if acquisition_row.status <> 'pending' then return jsonb_build_object('accepted', false, 'reason', 'acquisition_not_settleable'); end if;

  update public.canonical_world_saves
  set save_version = p_replacement->>'save_version',
      save_checksum = replacement_checksum,
      save_envelope = p_replacement->'save_envelope',
      season_id = p_replacement->>'season_id',
      season_number = nullif(p_replacement->>'season_number', '')::integer,
      phase = p_replacement->>'phase',
      matchday = nullif(p_replacement->>'matchday', '')::integer,
      next_turn_at = nullif(p_replacement->>'next_turn_at', '')::timestamptz,
      turn_status = p_replacement->>'turn_status',
      updated_at = nullif(p_replacement->>'updated_at', '')::timestamptz
  where world_id = acquisition_row.world_id
    and save_checksum = p_expected_checksum
    and turn_status = 'open'
  returning * into world_row;

  if world_row.world_id is null then return jsonb_build_object('accepted', false, 'reason', 'checkpoint_changed_or_busy'); end if;

  insert into public.world_read_model_cache(world_id, source_checksum, read_model, refreshed_at)
  values(acquisition_row.world_id, replacement_checksum, replacement_read_model, now())
  on conflict (world_id) do update
    set source_checksum = excluded.source_checksum,
        read_model = excluded.read_model,
        refreshed_at = excluded.refreshed_at;

  update public.player_acquisitions
  set status = 'completed',
      previous_checksum = p_expected_checksum,
      replacement_checksum = replacement_checksum,
      application_error = null,
      terminal_at = now(),
      updated_at = now()
  where id = acquisition_row.id
  returning * into acquisition_row;

  return jsonb_build_object(
    'accepted', true,
    'acquisition_id', acquisition_row.id,
    'status', acquisition_row.status,
    'previous_checksum', acquisition_row.previous_checksum,
    'replacement_checksum', acquisition_row.replacement_checksum
  );
end;
$$;

create or replace function public.fail_free_agent_acquisition(
  p_acquisition_id uuid,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  row_value public.player_acquisitions;
begin
  update public.player_acquisitions
  set status = case when status = 'pending' then 'application_failed' else status end,
      application_error = case when status = 'pending' then left(coalesce(p_reason, 'Free-agent acquisition failed'), 1000) else application_error end,
      terminal_at = case when status = 'pending' then now() else terminal_at end,
      updated_at = now()
  where id = p_acquisition_id
  returning * into row_value;
  if row_value.id is null then return jsonb_build_object('accepted', false, 'reason', 'acquisition_not_found'); end if;
  return jsonb_build_object('accepted', true, 'acquisition_id', row_value.id, 'status', row_value.status, 'application_error', row_value.application_error);
end;
$$;

create or replace function public.get_manager_player_acquisition_history_for_user(
  p_user_id uuid,
  p_world_id text,
  p_limit integer default 50
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  manager_id_value uuid;
  club_id_value text;
  result_value jsonb;
begin
  select profile.id, appointment.club_id
    into manager_id_value, club_id_value
  from public.manager_profiles profile
  join public.manager_appointments appointment
    on appointment.manager_id = profile.id
   and appointment.world_id = p_world_id
   and appointment.status = 'active'
  where profile.user_id = p_user_id
  limit 1;
  if manager_id_value is null then raise exception 'No active manager appointment for this user and world'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'deal_id', acquisition.id,
    'acquisition_id', acquisition.id,
    'acquisition_type', acquisition.acquisition_type,
    'status', acquisition.status,
    'revision_no', 1,
    'player_id', acquisition.player_id,
    'player_name', acquisition.player_name,
    'buyer_club_id', acquisition.club_id,
    'buyer_club_name', acquisition.club_id,
    'seller_club_id', null,
    'seller_club_name', 'Free agent',
    'direction', 'incoming',
    'counterpart_club_id', null,
    'counterpart_club_name', 'Free agent',
    'fee', 0,
    'contract_years', acquisition.contract_years,
    'terminal_reason', case when acquisition.status = 'completed' then 'free_agent_signed' else 'canonical_validation_failed' end,
    'settlement_error', acquisition.application_error,
    'created_at', acquisition.created_at,
    'updated_at', acquisition.updated_at,
    'terminal_at', acquisition.terminal_at
  ) order by coalesce(acquisition.terminal_at, acquisition.updated_at) desc), '[]'::jsonb)
  into result_value
  from (
    select * from public.player_acquisitions
    where world_id = p_world_id and manager_id = manager_id_value and status <> 'pending'
    order by coalesce(terminal_at, updated_at) desc
    limit greatest(1, least(coalesce(p_limit, 50), 100))
  ) acquisition;

  return result_value;
end;
$$;

revoke all on function public.create_free_agent_acquisition_for_user(uuid,text,text,text,text,jsonb,integer,bigint,text) from public, anon, authenticated;
grant execute on function public.create_free_agent_acquisition_for_user(uuid,text,text,text,text,jsonb,integer,bigint,text) to service_role;
revoke all on function public.apply_free_agent_acquisition_settlement(uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.apply_free_agent_acquisition_settlement(uuid,text,jsonb) to service_role;
revoke all on function public.fail_free_agent_acquisition(uuid,text) from public, anon, authenticated;
grant execute on function public.fail_free_agent_acquisition(uuid,text) to service_role;
revoke all on function public.get_manager_player_acquisition_history_for_user(uuid,text,integer) from public, anon, authenticated;
grant execute on function public.get_manager_player_acquisition_history_for_user(uuid,text,integer) to service_role;

commit;
