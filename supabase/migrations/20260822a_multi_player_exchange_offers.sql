-- #272 Slice A/B: multi-player two-club exchange offer foundation.
--
-- The underlying transfer schema already supports ordered permanent-transfer,
-- cash and loan legs. This migration adds a service-gated two-club exchange
-- gateway over that schema without weakening the existing straight-transfer
-- contract. Settlement remains deliberately out of scope here: complex deals
-- are not allowed to enter the agreed/binding path until the atomic settlement
-- slice is deployed.

begin;

create or replace function public.set_manager_transfer_exchange_offer_for_user(
  p_user_id uuid,
  p_world_id text,
  p_counterpart_club_id text,
  p_legs jsonb,
  p_request_key text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  manager_id_value uuid;
  club_id_value text;
  counterpart_manager_id_value uuid;
  cache_row public.world_read_model_cache;
  canonical_checksum text;
  existing_event public.transfer_deal_events;
  deal_row public.transfer_deals;
  revision_row public.transfer_deal_revisions;
  request_lock_key bigint;
  leg_value jsonb;
  leg_ordinal bigint;
  leg_type_value text;
  from_club_id_value text;
  to_club_id_value text;
  player_id_value text;
  amount_value numeric;
  contract_years_value integer;
  player_owner_value text;
  seen_player_ids text[] := array[]::text[];
  player_leg_count integer := 0;
  normalized_legs jsonb := '[]'::jsonb;
begin
  if p_user_id is null then raise exception 'Verified user identity is required'; end if;
  if trim(coalesce(p_counterpart_club_id, '')) = '' then raise exception 'Counterpart club is required'; end if;
  if trim(coalesce(p_request_key, '')) = '' then raise exception 'Request key is required'; end if;
  if p_legs is null or jsonb_typeof(p_legs) <> 'array' or jsonb_array_length(p_legs) = 0 then
    raise exception 'Exchange legs are required';
  end if;

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
  if p_counterpart_club_id = club_id_value then raise exception 'A different counterpart club is required'; end if;

  select appointment.manager_id
    into counterpart_manager_id_value
  from public.manager_appointments appointment
  where appointment.world_id = p_world_id
    and appointment.club_id = p_counterpart_club_id
    and appointment.status = 'active'
  limit 1;
  if counterpart_manager_id_value is null then
    raise exception 'Exchange offers currently require another human-managed club';
  end if;

  request_lock_key := pg_catalog.hashtextextended(
    concat_ws('|', p_world_id, manager_id_value::text, p_request_key), 0
  );
  perform pg_catalog.pg_advisory_xact_lock(request_lock_key);

  select * into existing_event
  from public.transfer_deal_events event
  where event.world_id = p_world_id
    and event.manager_id = manager_id_value
    and event.request_key = p_request_key
  limit 1;
  if existing_event.id is not null then
    select * into deal_row from public.transfer_deals where id = existing_event.deal_id;
    return jsonb_build_object(
      'deal_id', deal_row.id,
      'status', deal_row.status,
      'revision_no', deal_row.current_revision_no,
      'idempotent', true
    );
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

  -- Validate and normalize the whole proposed revision before writing any deal rows.
  for leg_value, leg_ordinal in
    select value, ordinality
    from jsonb_array_elements(p_legs) with ordinality
  loop
    leg_type_value := lower(trim(coalesce(leg_value->>'leg_type', '')));
    from_club_id_value := trim(coalesce(leg_value->>'from_club_id', ''));
    to_club_id_value := trim(coalesce(leg_value->>'to_club_id', ''));

    if leg_type_value not in ('permanent_transfer', 'cash') then
      raise exception 'Two-club exchange offers currently support only permanent player and cash legs';
    end if;
    if from_club_id_value not in (club_id_value, p_counterpart_club_id)
       or to_club_id_value not in (club_id_value, p_counterpart_club_id)
       or from_club_id_value = to_club_id_value then
      raise exception 'Every exchange leg must move between the two participating clubs';
    end if;

    if leg_type_value = 'permanent_transfer' then
      player_id_value := trim(coalesce(leg_value->>'player_id', ''));
      if player_id_value = '' then raise exception 'Every permanent-transfer leg requires a player'; end if;
      if player_id_value = any(seen_player_ids) then
        raise exception 'The same player cannot appear more than once in an exchange revision';
      end if;
      seen_player_ids := array_append(seen_player_ids, player_id_value);

      player_owner_value := coalesce(
        cache_row.read_model #>> array['squad_cycle','players',player_id_value,'club_id'], ''
      );
      if player_owner_value = '' then raise exception 'Exchange player is not present in the canonical world'; end if;
      if player_owner_value <> from_club_id_value then
        raise exception 'Exchange player is not owned by the club offering that player';
      end if;

      contract_years_value := case
        when coalesce(leg_value->>'contract_years', '') ~ '^[0-9]+$'
          then greatest(1, least((leg_value->>'contract_years')::integer, 5))
        else 3
      end;
      player_leg_count := player_leg_count + 1;
      normalized_legs := normalized_legs || jsonb_build_array(jsonb_build_object(
        'sequence_no', leg_ordinal,
        'leg_type', 'permanent_transfer',
        'from_club_id', from_club_id_value,
        'to_club_id', to_club_id_value,
        'player_id', player_id_value,
        'contract_years', contract_years_value
      ));
    else
      if coalesce(leg_value->>'amount', '') !~ '^[0-9]+([.][0-9]+)?$' then
        raise exception 'Every cash leg requires a non-negative numeric amount';
      end if;
      amount_value := (leg_value->>'amount')::numeric;
      if amount_value <= 0 then raise exception 'Cash legs must be greater than zero'; end if;
      normalized_legs := normalized_legs || jsonb_build_array(jsonb_build_object(
        'sequence_no', leg_ordinal,
        'leg_type', 'cash',
        'from_club_id', from_club_id_value,
        'to_club_id', to_club_id_value,
        'amount', amount_value
      ));
    end if;
  end loop;

  if player_leg_count = 0 then raise exception 'An exchange offer must include at least one player'; end if;

  insert into public.transfer_deals(world_id, created_by_manager_id, status, current_revision_no)
  values(p_world_id, manager_id_value, 'negotiating', 1)
  returning * into deal_row;

  insert into public.transfer_deal_revisions(deal_id, revision_no, created_by_manager_id, summary)
  values(
    deal_row.id,
    1,
    manager_id_value,
    jsonb_build_object(
      'type', 'two_club_exchange_offer',
      'legs', normalized_legs,
      'player_leg_count', player_leg_count
    )
  )
  returning * into revision_row;

  -- Retain buyer/seller role labels for compatibility with the existing two-club
  -- negotiation/read-model path. The legs, not the role labels, are authoritative
  -- about what each club gives and receives.
  insert into public.transfer_deal_participants(deal_id, club_id, manager_id, role) values
    (deal_row.id, club_id_value, manager_id_value, 'buyer'),
    (deal_row.id, p_counterpart_club_id, counterpart_manager_id_value, 'seller');

  for leg_value in select value from jsonb_array_elements(normalized_legs)
  loop
    if leg_value->>'leg_type' = 'permanent_transfer' then
      insert into public.transfer_deal_legs(
        revision_id, sequence_no, leg_type, from_club_id, to_club_id, player_id, terms
      ) values (
        revision_row.id,
        (leg_value->>'sequence_no')::integer,
        'permanent_transfer',
        leg_value->>'from_club_id',
        leg_value->>'to_club_id',
        leg_value->>'player_id',
        jsonb_build_object('contract_years', (leg_value->>'contract_years')::integer)
      );
    else
      insert into public.transfer_deal_legs(
        revision_id, sequence_no, leg_type, from_club_id, to_club_id, amount
      ) values (
        revision_row.id,
        (leg_value->>'sequence_no')::integer,
        'cash',
        leg_value->>'from_club_id',
        leg_value->>'to_club_id',
        (leg_value->>'amount')::numeric
      );
    end if;
  end loop;

  insert into public.transfer_deal_approvals(revision_id, club_id, manager_id, decision)
  values(revision_row.id, club_id_value, manager_id_value, 'approved');

  insert into public.transfer_deal_events(
    deal_id, world_id, manager_id, event_type, request_key, details
  ) values (
    deal_row.id,
    p_world_id,
    manager_id_value,
    'offered',
    p_request_key,
    jsonb_build_object(
      'type', 'two_club_exchange_offer',
      'counterpart_club_id', p_counterpart_club_id,
      'legs', normalized_legs
    )
  );

  return jsonb_build_object(
    'deal_id', deal_row.id,
    'status', deal_row.status,
    'revision_no', 1,
    'legs', normalized_legs
  );
end;
$$;

revoke all on function public.set_manager_transfer_exchange_offer_for_user(uuid,text,text,jsonb,text)
  from public, anon, authenticated;
grant execute on function public.set_manager_transfer_exchange_offer_for_user(uuid,text,text,jsonb,text)
  to service_role;

-- Additive projection used by the Manager gateway to decorate the existing
-- transfer-market response. Keeping this separate avoids destabilising the
-- straight-transfer read model while #272 is delivered in slices.
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
  cache_row public.world_read_model_cache;
  canonical_checksum text;
  result_value jsonb;
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

  select save_checksum into canonical_checksum
  from public.canonical_world_saves where world_id = p_world_id limit 1;
  select * into cache_row
  from public.world_read_model_cache where world_id = p_world_id limit 1;
  if cache_row.read_model is null
     or canonical_checksum is null
     or cache_row.source_checksum <> canonical_checksum then
    raise exception 'World read model is refreshing; please retry shortly';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'deal_id', deal.id,
    'revision_no', revision.revision_no,
    'legs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'sequence_no', leg.sequence_no,
        'leg_type', leg.leg_type,
        'from_club_id', leg.from_club_id,
        'from_club_name', coalesce(
          cache_row.read_model #>> array['club_profiles',leg.from_club_id,'club_name'],
          cache_row.read_model #>> array['club_profiles',leg.from_club_id,'canonical_name'],
          leg.from_club_id
        ),
        'to_club_id', leg.to_club_id,
        'to_club_name', coalesce(
          cache_row.read_model #>> array['club_profiles',leg.to_club_id,'club_name'],
          cache_row.read_model #>> array['club_profiles',leg.to_club_id,'canonical_name'],
          leg.to_club_id
        ),
        'player_id', leg.player_id,
        'player_name', case when leg.player_id is null then null else coalesce(
          cache_row.read_model #>> array['squad_cycle','players',leg.player_id,'display_name'],
          cache_row.read_model #>> array['squad_cycle','players',leg.player_id,'player_name'],
          leg.player_id
        ) end,
        'position', case when leg.player_id is null then null else
          cache_row.read_model #>> array['squad_cycle','players',leg.player_id,'position'] end,
        'rating', case when leg.player_id is null then null else coalesce(
          cache_row.read_model #>> array['squad_cycle','players',leg.player_id,'rating'],
          cache_row.read_model #>> array['squad_cycle','players',leg.player_id,'underlying_ability_rating']
        ) end,
        'age', case when leg.player_id is null then null else
          cache_row.read_model #>> array['squad_cycle','players',leg.player_id,'age'] end,
        'amount', leg.amount,
        'contract_years', case
          when coalesce(leg.terms->>'contract_years', '') ~ '^[0-9]+$'
            then greatest(1, least((leg.terms->>'contract_years')::integer, 5))
          else null
        end
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

revoke all on function public.get_manager_transfer_exchange_legs_for_user(uuid,text)
  from public, anon, authenticated;
grant execute on function public.get_manager_transfer_exchange_legs_for_user(uuid,text)
  to service_role;

commit;
