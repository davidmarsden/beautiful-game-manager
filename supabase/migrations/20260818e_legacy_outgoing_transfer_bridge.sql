-- #240 migration bridge: surface and safely withdraw pre-first-class outgoing offers.

begin;

create or replace function public.get_manager_legacy_outgoing_transfer_offers_for_user(
  p_user_id uuid,
  p_world_id text
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  manager_id_value uuid;
  club_id_value text;
  cache_row public.world_read_model_cache;
  canonical_checksum text;
  offers_value jsonb;
begin
  if p_user_id is null then raise exception 'Verified user identity is required'; end if;

  select profile.id, appointment.club_id
    into manager_id_value, club_id_value
  from public.manager_profiles profile
  join public.manager_appointments appointment
    on appointment.manager_id = profile.id
   and appointment.world_id = p_world_id
   and appointment.status = 'active'
  where profile.user_id = p_user_id
  limit 1;

  if manager_id_value is null then
    raise exception 'No active manager appointment for this user and world';
  end if;

  select save_checksum into canonical_checksum
  from public.canonical_world_saves
  where world_id = p_world_id
  limit 1;

  select * into cache_row
  from public.world_read_model_cache
  where world_id = p_world_id
  limit 1;

  if cache_row.read_model is null
     or canonical_checksum is null
     or cache_row.source_checksum <> canonical_checksum then
    raise exception 'World read model is refreshing; please retry shortly';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'proposal_id', offer.id,
    'player_id', coalesce(offer.command_payload->>'playerId', offer.command_payload->>'player_id'),
    'player_name', coalesce(
      cache_row.read_model #>> array['squad_cycle','players',coalesce(offer.command_payload->>'playerId', offer.command_payload->>'player_id'),'display_name'],
      cache_row.read_model #>> array['squad_cycle','players',coalesce(offer.command_payload->>'playerId', offer.command_payload->>'player_id'),'player_name'],
      coalesce(offer.command_payload->>'playerId', offer.command_payload->>'player_id')
    ),
    'seller_club_id', coalesce(offer.command_payload->>'otherClubId', offer.command_payload->>'other_club_id'),
    'seller_club_name', coalesce(
      cache_row.read_model #>> array['club_profiles',coalesce(offer.command_payload->>'otherClubId', offer.command_payload->>'other_club_id'),'club_name'],
      cache_row.read_model #>> array['club_profiles',coalesce(offer.command_payload->>'otherClubId', offer.command_payload->>'other_club_id'),'canonical_name']
    ),
    'fee', coalesce((offer.command_payload->>'fee')::numeric, 0),
    'contract_years', coalesce((offer.command_payload->>'contractYears')::integer, (offer.command_payload->>'contract_years')::integer, 3),
    'created_at', offer.submitted_at,
    'status', offer.status,
    'negotiation_state', offer.negotiation_state
  ) order by offer.submitted_at desc), '[]'::jsonb)
  into offers_value
  from public.manager_world_commands offer
  where offer.world_id = p_world_id
    and offer.manager_id = manager_id_value
    and offer.club_id = club_id_value
    and offer.command_type = 'transfer_offer'
    and offer.status = 'pending'
    and not exists (
      select 1
      from public.manager_world_commands response
      where response.referenced_command_id = offer.id
        and response.command_type = 'transfer_response'
    );

  return offers_value;
end;
$$;

create or replace function public.withdraw_manager_legacy_transfer_offer_for_user(
  p_user_id uuid,
  p_world_id text,
  p_proposal_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  manager_id_value uuid;
  club_id_value text;
  offer public.manager_world_commands;
  finalized public.manager_world_commands;
begin
  if p_user_id is null then raise exception 'Verified user identity is required'; end if;
  if p_proposal_id is null then raise exception 'Transfer offer is required'; end if;

  select profile.id, appointment.club_id
    into manager_id_value, club_id_value
  from public.manager_profiles profile
  join public.manager_appointments appointment
    on appointment.manager_id = profile.id
   and appointment.world_id = p_world_id
   and appointment.status = 'active'
  where profile.user_id = p_user_id
  limit 1;

  if manager_id_value is null then
    raise exception 'No active manager appointment for this user and world';
  end if;

  select * into offer
  from public.manager_world_commands command
  where command.id = p_proposal_id
    and command.world_id = p_world_id
    and command.manager_id = manager_id_value
    and command.club_id = club_id_value
    and command.command_type = 'transfer_offer'
  for update;

  if offer.id is null then raise exception 'Legacy transfer offer was not found'; end if;

  if offer.status = 'superseded' and offer.negotiation_state = 'withdrawn' then
    return jsonb_build_object('proposal_id', offer.id, 'status', offer.status, 'idempotent', true);
  end if;

  if offer.status <> 'pending' then raise exception 'Only a pending legacy transfer offer can be withdrawn'; end if;
  if exists (
    select 1 from public.manager_world_commands response
    where response.referenced_command_id = offer.id
      and response.command_type = 'transfer_response'
  ) then
    raise exception 'This transfer offer has already received a response and can no longer be withdrawn';
  end if;

  select * into finalized
  from public.finalize_manager_world_command(
    offer.id,
    'superseded',
    'Transfer offer withdrawn by the buyer before receiving a response.',
    jsonb_build_object('withdrawn_by_manager_id', manager_id_value, 'migration_bridge', true),
    'withdrawn',
    'Transfer offer withdrawn',
    'normal',
    now()
  );

  return jsonb_build_object('proposal_id', finalized.id, 'status', finalized.status, 'negotiation_state', finalized.negotiation_state);
end;
$$;

revoke all on function public.get_manager_legacy_outgoing_transfer_offers_for_user(uuid,text)
  from public, anon, authenticated;
grant execute on function public.get_manager_legacy_outgoing_transfer_offers_for_user(uuid,text)
  to service_role;

revoke all on function public.withdraw_manager_legacy_transfer_offer_for_user(uuid,text,uuid)
  from public, anon, authenticated;
grant execute on function public.withdraw_manager_legacy_transfer_offer_for_user(uuid,text,uuid)
  to service_role;

commit;
