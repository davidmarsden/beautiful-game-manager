-- Controlled-alpha incident hardening.
-- Transfer RPCs must not detoast/traverse the ~1MB world_read_model_cache for routine reads.
-- Reuse the compact manager_transfer_directory_cache instead, rebuilding it at most once per world/checksum.

begin;

create or replace function public.get_manager_transfer_lookup_for_user(
  p_user_id uuid,
  p_world_id text
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  canonical_checksum text;
  cached_directory jsonb;
  directory_payload jsonb;
  players_by_id jsonb := '{}'::jsonb;
  clubs_by_id jsonb := '{}'::jsonb;
begin
  if p_user_id is null then raise exception 'Verified user identity is required'; end if;

  select save_checksum into canonical_checksum
  from public.canonical_world_saves
  where world_id = p_world_id
  limit 1;

  if canonical_checksum is null then return null; end if;

  select cache.directory into cached_directory
  from public.manager_transfer_directory_cache cache
  where cache.world_id = p_world_id
    and cache.source_checksum = canonical_checksum;

  if cached_directory is null then
    -- Only cache misses serialize. Healthy cache hits remain fully concurrent.
    perform pg_advisory_xact_lock(hashtextextended('tbg-transfer-directory:' || p_world_id, 0));

    select cache.directory into cached_directory
    from public.manager_transfer_directory_cache cache
    where cache.world_id = p_world_id
      and cache.source_checksum = canonical_checksum;

    if cached_directory is null then
      directory_payload := public.get_manager_transfer_directory_for_user(p_user_id, p_world_id);
      cached_directory := directory_payload -> 'directory';
    end if;
  end if;

  if cached_directory is null then
    raise exception 'Transfer directory is refreshing; please retry shortly';
  end if;

  select coalesce(jsonb_object_agg(player.value ->> 'player_id', player.value), '{}'::jsonb)
    into players_by_id
  from jsonb_array_elements(coalesce(cached_directory -> 'players', '[]'::jsonb)) player(value)
  where coalesce(player.value ->> 'player_id', '') <> '';

  select coalesce(jsonb_object_agg(club.value ->> 'club_id', club.value), '{}'::jsonb)
    into clubs_by_id
  from jsonb_array_elements(coalesce(cached_directory -> 'clubs', '[]'::jsonb)) club(value)
  where coalesce(club.value ->> 'club_id', '') <> '';

  return jsonb_build_object(
    'save_checksum', canonical_checksum,
    'players_by_id', players_by_id,
    'clubs_by_id', clubs_by_id
  );
end;
$$;

revoke all on function public.get_manager_transfer_lookup_for_user(uuid,text) from public, anon, authenticated;
grant execute on function public.get_manager_transfer_lookup_for_user(uuid,text) to service_role;

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
  lookup jsonb;
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

  if manager_id_value is null then raise exception 'No active manager appointment for this user and world'; end if;
  lookup := public.get_manager_transfer_lookup_for_user(p_user_id, p_world_id);

  select coalesce(jsonb_agg(jsonb_build_object(
    'proposal_id', offer.id,
    'player_id', coalesce(offer.command_payload->>'playerId', offer.command_payload->>'player_id'),
    'player_name', coalesce(
      lookup -> 'players_by_id' -> coalesce(offer.command_payload->>'playerId', offer.command_payload->>'player_id') ->> 'player_name',
      coalesce(offer.command_payload->>'playerId', offer.command_payload->>'player_id')
    ),
    'seller_club_id', coalesce(offer.command_payload->>'otherClubId', offer.command_payload->>'other_club_id'),
    'seller_club_name', coalesce(
      lookup -> 'clubs_by_id' -> coalesce(offer.command_payload->>'otherClubId', offer.command_payload->>'other_club_id') ->> 'club_name',
      coalesce(offer.command_payload->>'otherClubId', offer.command_payload->>'other_club_id')
    ),
    'fee', case when coalesce(offer.command_payload->>'fee', '') ~ '^-?[0-9]+([.][0-9]+)?$'
      then (offer.command_payload->>'fee')::numeric else 0 end,
    'contract_years', case when coalesce(offer.command_payload->>'contractYears', offer.command_payload->>'contract_years', '') ~ '^[0-9]+$'
      then greatest(1, least(coalesce(offer.command_payload->>'contractYears', offer.command_payload->>'contract_years')::integer, 5)) else 3 end,
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
      select 1 from public.manager_world_commands response
      where response.referenced_command_id = offer.id
        and response.command_type = 'transfer_response'
    );

  return offers_value;
end;
$$;

create or replace function public.get_manager_transfer_listings_for_user(
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
  lookup jsonb;
  listings_value jsonb;
begin
  if p_user_id is null then raise exception 'Verified user identity is required'; end if;

  select profile.id, appointment.club_id into manager_id_value, club_id_value
  from public.manager_profiles profile
  join public.manager_appointments appointment
    on appointment.manager_id = profile.id
   and appointment.world_id = p_world_id
   and appointment.status = 'active'
  where profile.user_id = p_user_id
  limit 1;
  if manager_id_value is null then raise exception 'No active manager appointment for this user and world'; end if;

  lookup := public.get_manager_transfer_lookup_for_user(p_user_id, p_world_id);

  select coalesce(jsonb_agg(jsonb_build_object(
    'listing_id', listing.id,
    'player_id', listing.player_id,
    'player_name', coalesce(lookup -> 'players_by_id' -> listing.player_id ->> 'player_name', listing.player_id),
    'club_id', listing.club_id,
    'asking_fee', listing.asking_fee,
    'status', listing.status,
    'created_at', listing.created_at,
    'updated_at', listing.updated_at,
    'is_own_listing', listing.club_id = club_id_value
  ) order by listing.updated_at desc), '[]'::jsonb)
  into listings_value
  from public.transfer_market_listings listing
  where listing.world_id = p_world_id
    and listing.status = 'active'
    and coalesce(lookup -> 'players_by_id' -> listing.player_id ->> 'club_id', '') = listing.club_id;

  return jsonb_build_object('world_id', p_world_id, 'club_id', club_id_value, 'listings', listings_value);
end;
$$;

create or replace function public.get_manager_transfer_exchange_legs_for_user(
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
  lookup jsonb;
  result_value jsonb;
begin
  if p_user_id is null then raise exception 'Verified user identity is required'; end if;

  select profile.id, appointment.club_id into manager_id_value, club_id_value
  from public.manager_profiles profile
  join public.manager_appointments appointment
    on appointment.manager_id = profile.id
   and appointment.world_id = p_world_id
   and appointment.status = 'active'
  where profile.user_id = p_user_id
  limit 1;
  if manager_id_value is null then raise exception 'No active manager appointment for this user and world'; end if;

  lookup := public.get_manager_transfer_lookup_for_user(p_user_id, p_world_id);

  select coalesce(jsonb_agg(jsonb_build_object(
    'deal_id', deal.id,
    'revision_no', revision.revision_no,
    'legs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'sequence_no', leg.sequence_no,
        'leg_type', leg.leg_type,
        'from_club_id', leg.from_club_id,
        'from_club_name', coalesce(lookup -> 'clubs_by_id' -> leg.from_club_id ->> 'club_name', leg.from_club_id),
        'to_club_id', leg.to_club_id,
        'to_club_name', coalesce(lookup -> 'clubs_by_id' -> leg.to_club_id ->> 'club_name', leg.to_club_id),
        'player_id', leg.player_id,
        'player_name', case when leg.player_id is null then null else coalesce(lookup -> 'players_by_id' -> leg.player_id ->> 'player_name', leg.player_id) end,
        'position', case when leg.player_id is null then null else lookup -> 'players_by_id' -> leg.player_id ->> 'position' end,
        'rating', case when leg.player_id is null then null else lookup -> 'players_by_id' -> leg.player_id ->> 'rating' end,
        'age', null,
        'amount', leg.amount,
        'contract_years', case when coalesce(leg.terms->>'contract_years', '') ~ '^[0-9]+$'
          then greatest(1, least((leg.terms->>'contract_years')::integer, 5)) else null end
      ) order by leg.sequence_no asc)
      from public.transfer_deal_legs leg
      where leg.revision_id = revision.id
    ), '[]'::jsonb)
  ) order by deal.updated_at desc), '[]'::jsonb)
  into result_value
  from public.transfer_deals deal
  join public.transfer_deal_participants participant
    on participant.deal_id = deal.id and participant.club_id = club_id_value
  join public.transfer_deal_revisions revision
    on revision.deal_id = deal.id and revision.revision_no = deal.current_revision_no
  where deal.world_id = p_world_id
    and deal.status in ('negotiating', 'agreed', 'grace_period', 'binding', 'settling');

  return result_value;
end;
$$;

create or replace function public.get_manager_transfer_history_for_user(
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
  club_id_value text;
  lookup jsonb;
  result_value jsonb;
begin
  select appointment.club_id into club_id_value
  from public.manager_profiles profile
  join public.manager_appointments appointment
    on appointment.manager_id = profile.id
   and appointment.world_id = p_world_id
   and appointment.status = 'active'
  where profile.user_id = p_user_id
  limit 1;
  if club_id_value is null then raise exception 'No active manager appointment for this user and world'; end if;

  lookup := public.get_manager_transfer_lookup_for_user(p_user_id, p_world_id);

  with terminal_deals as (
    select deal.id, deal.status, deal.current_revision_no, deal.created_at, deal.updated_at,
      deal.terminal_at, deal.terminal_reason, deal.settlement_error,
      buyer.club_id as buyer_club_id, seller.club_id as seller_club_id,
      revision.id as revision_id,
      (select leg.player_id from public.transfer_deal_legs leg
        where leg.revision_id = revision.id and leg.leg_type = 'permanent_transfer'
        order by leg.sequence_no limit 1) as player_id,
      coalesce((select sum(leg.amount) from public.transfer_deal_legs leg
        where leg.revision_id = revision.id and leg.leg_type = 'cash'), 0) as fee,
      coalesce((select case when coalesce(leg.terms->>'contract_years', '') ~ '^[0-9]+$'
        then greatest(1, least((leg.terms->>'contract_years')::integer, 5)) else 3 end
        from public.transfer_deal_legs leg
        where leg.revision_id = revision.id and leg.leg_type = 'permanent_transfer'
        order by leg.sequence_no limit 1), 3) as contract_years
    from public.transfer_deals deal
    join public.transfer_deal_participants buyer on buyer.deal_id = deal.id and buyer.role = 'buyer'
    join public.transfer_deal_participants seller on seller.deal_id = deal.id and seller.role = 'seller'
    join public.transfer_deal_revisions revision on revision.deal_id = deal.id and revision.revision_no = deal.current_revision_no
    where deal.world_id = p_world_id
      and deal.status not in ('negotiating', 'agreed')
      and (buyer.club_id = club_id_value or seller.club_id = club_id_value)
    order by coalesce(deal.terminal_at, deal.updated_at) desc
    limit greatest(1, least(coalesce(p_limit, 50), 100))
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'deal_id', td.id,
    'status', td.status,
    'revision_no', td.current_revision_no,
    'player_id', td.player_id,
    'player_name', coalesce(lookup -> 'players_by_id' -> td.player_id ->> 'player_name', td.player_id),
    'buyer_club_id', td.buyer_club_id,
    'buyer_club_name', coalesce(lookup -> 'clubs_by_id' -> td.buyer_club_id ->> 'club_name', td.buyer_club_id),
    'seller_club_id', td.seller_club_id,
    'seller_club_name', coalesce(lookup -> 'clubs_by_id' -> td.seller_club_id ->> 'club_name', td.seller_club_id),
    'direction', case when td.buyer_club_id = club_id_value then 'incoming' else 'outgoing' end,
    'counterpart_club_id', case when td.buyer_club_id = club_id_value then td.seller_club_id else td.buyer_club_id end,
    'counterpart_club_name', case when td.buyer_club_id = club_id_value
      then coalesce(lookup -> 'clubs_by_id' -> td.seller_club_id ->> 'club_name', td.seller_club_id)
      else coalesce(lookup -> 'clubs_by_id' -> td.buyer_club_id ->> 'club_name', td.buyer_club_id) end,
    'fee', td.fee,
    'contract_years', td.contract_years,
    'legs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'sequence_no', leg.sequence_no,
        'leg_type', leg.leg_type,
        'from_club_id', leg.from_club_id,
        'from_club_name', coalesce(lookup -> 'clubs_by_id' -> leg.from_club_id ->> 'club_name', leg.from_club_id),
        'to_club_id', leg.to_club_id,
        'to_club_name', coalesce(lookup -> 'clubs_by_id' -> leg.to_club_id ->> 'club_name', leg.to_club_id),
        'player_id', leg.player_id,
        'player_name', case when leg.player_id is null then null else coalesce(lookup -> 'players_by_id' -> leg.player_id ->> 'player_name', leg.player_id) end,
        'amount', leg.amount,
        'contract_years', case when coalesce(leg.terms->>'contract_years', '') ~ '^[0-9]+$'
          then greatest(1, least((leg.terms->>'contract_years')::integer, 5)) else null end
      ) order by leg.sequence_no)
      from public.transfer_deal_legs leg where leg.revision_id = td.revision_id
    ), '[]'::jsonb),
    'terminal_reason', td.terminal_reason,
    'settlement_error', td.settlement_error,
    'created_at', td.created_at,
    'updated_at', td.updated_at,
    'terminal_at', td.terminal_at
  ) order by coalesce(td.terminal_at, td.updated_at) desc), '[]'::jsonb)
  into result_value from terminal_deals td;

  return result_value;
end;
$$;

create or replace function public.get_world_transfer_register_for_user(
  p_user_id uuid,
  p_world_id text,
  p_limit integer default 100
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  manager_id_value uuid;
  lookup jsonb;
  result_value jsonb;
begin
  select profile.id into manager_id_value
  from public.manager_profiles profile
  join public.manager_appointments appointment
    on appointment.manager_id = profile.id
   and appointment.world_id = p_world_id
   and appointment.status = 'active'
  where profile.user_id = p_user_id
  limit 1;
  if manager_id_value is null then raise exception 'No active manager appointment for this user and world'; end if;

  lookup := public.get_manager_transfer_lookup_for_user(p_user_id, p_world_id);

  with visible_deals as (
    select deal.id, deal.status, deal.current_revision_no, deal.created_at, deal.updated_at,
      deal.grace_expires_at - make_interval(mins => coalesce(deal.integrity_cooling_minutes, 15)) as agreed_at,
      deal.grace_expires_at, deal.binding_at, deal.settle_at, deal.terminal_at, deal.terminal_reason,
      deal.integrity_level, deal.integrity_reasons, deal.integrity_cooling_minutes, revision.id as revision_id
    from public.transfer_deals deal
    join public.transfer_deal_revisions revision on revision.deal_id = deal.id and revision.revision_no = deal.current_revision_no
    where deal.world_id = p_world_id and deal.grace_expires_at is not null
    order by coalesce(deal.terminal_at, deal.updated_at) desc
    limit greatest(1, least(coalesce(p_limit, 100), 200))
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'deal_id', deal.id,
    'status', deal.status,
    'effective_state', case when deal.status = 'agreed' and now() < deal.grace_expires_at then 'grace_period'
      when deal.status = 'agreed' then 'binding' else deal.status end,
    'revision_no', deal.current_revision_no,
    'agreed_at', deal.agreed_at,
    'grace_expires_at', deal.grace_expires_at,
    'binding_at', deal.binding_at,
    'settle_at', deal.settle_at,
    'terminal_at', deal.terminal_at,
    'terminal_reason', deal.terminal_reason,
    'integrity_level', deal.integrity_level,
    'integrity_reasons', deal.integrity_reasons,
    'integrity_cooling_minutes', deal.integrity_cooling_minutes,
    'already_reported_by_me', exists (
      select 1 from public.transfer_integrity_reports report
      where report.deal_id = deal.id and report.reporter_manager_id = manager_id_value
    ),
    'legs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'sequence_no', leg.sequence_no,
        'leg_type', leg.leg_type,
        'from_club_id', leg.from_club_id,
        'from_club_name', coalesce(lookup -> 'clubs_by_id' -> leg.from_club_id ->> 'club_name', leg.from_club_id),
        'to_club_id', leg.to_club_id,
        'to_club_name', coalesce(lookup -> 'clubs_by_id' -> leg.to_club_id ->> 'club_name', leg.to_club_id),
        'player_id', leg.player_id,
        'player_name', case when leg.player_id is null then null else coalesce(lookup -> 'players_by_id' -> leg.player_id ->> 'player_name', leg.player_id) end,
        'amount', leg.amount,
        'contract_years', case when coalesce(leg.terms->>'contract_years','') ~ '^[0-9]+$'
          then greatest(1, least((leg.terms->>'contract_years')::integer, 5)) else null end
      ) order by leg.sequence_no)
      from public.transfer_deal_legs leg where leg.revision_id = deal.revision_id
    ), '[]'::jsonb)
  ) order by coalesce(deal.terminal_at, deal.updated_at) desc), '[]'::jsonb)
  into result_value from visible_deals deal;

  return result_value;
end;
$$;

-- Preserve the existing service-role-only RPC surface.
revoke all on function public.get_manager_legacy_outgoing_transfer_offers_for_user(uuid,text) from public, anon, authenticated;
revoke all on function public.get_manager_transfer_listings_for_user(uuid,text) from public, anon, authenticated;
revoke all on function public.get_manager_transfer_exchange_legs_for_user(uuid,text) from public, anon, authenticated;
revoke all on function public.get_manager_transfer_history_for_user(uuid,text,integer) from public, anon, authenticated;
revoke all on function public.get_world_transfer_register_for_user(uuid,text,integer) from public, anon, authenticated;
grant execute on function public.get_manager_legacy_outgoing_transfer_offers_for_user(uuid,text) to service_role;
grant execute on function public.get_manager_transfer_listings_for_user(uuid,text) to service_role;
grant execute on function public.get_manager_transfer_exchange_legs_for_user(uuid,text) to service_role;
grant execute on function public.get_manager_transfer_history_for_user(uuid,text,integer) to service_role;
grant execute on function public.get_world_transfer_register_for_user(uuid,text,integer) to service_role;

commit;
