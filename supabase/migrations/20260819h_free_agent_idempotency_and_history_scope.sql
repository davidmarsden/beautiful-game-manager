-- #240 review hardening: preserve idempotent free-agent retries and scope history to the active club.

begin;

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

  -- A request-key replay is authoritative even after the acquisition completed.
  -- This lets a client safely retry after a lost/timed-out success response.
  select * into row_value
  from public.player_acquisitions
  where world_id = p_world_id
    and manager_id = manager_id_value
    and request_key = p_request_key
  limit 1;

  if row_value.id is not null then
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
  end if;

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
  if manager_id_value is null or club_id_value is null then raise exception 'No active manager appointment for this user and world'; end if;

  -- Transfer History belongs to the club currently being managed, not to the
  -- manager's lifetime identity. This also exposes signings made by prior managers.
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
    where world_id = p_world_id
      and club_id = club_id_value
      and status <> 'pending'
    order by coalesce(terminal_at, updated_at) desc
    limit greatest(1, least(coalesce(p_limit, 50), 100))
  ) acquisition;

  return result_value;
end;
$$;

revoke all on function public.create_free_agent_acquisition_for_user(uuid,text,text,text,text,jsonb,integer,bigint,text) from public, anon, authenticated;
grant execute on function public.create_free_agent_acquisition_for_user(uuid,text,text,text,text,jsonb,integer,bigint,text) to service_role;
revoke all on function public.get_manager_player_acquisition_history_for_user(uuid,text,integer) from public, anon, authenticated;
grant execute on function public.get_manager_player_acquisition_history_for_user(uuid,text,integer) to service_role;

commit;
