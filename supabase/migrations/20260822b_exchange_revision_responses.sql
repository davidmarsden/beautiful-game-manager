-- #272 Slice C: exact-revision accept, decline and full-leg countering for two-club exchanges.

begin;

create or replace function public.respond_manager_transfer_exchange_deal_for_user(
  p_user_id uuid,
  p_world_id text,
  p_deal_id uuid,
  p_revision_no integer,
  p_action text,
  p_legs jsonb default null,
  p_request_key text default null
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  manager_id_value uuid;
  club_id_value text;
  counterpart_club_id_value text;
  action_value text := lower(trim(coalesce(p_action, '')));
  deal_row public.transfer_deals;
  current_revision public.transfer_deal_revisions;
  new_revision public.transfer_deal_revisions;
  existing_event public.transfer_deal_events;
  cache_row public.world_read_model_cache;
  canonical_checksum text;
  request_lock_key bigint;
  participant_count integer;
  approvals_count integer;
  leg_value jsonb;
  leg_ordinal bigint;
  leg_type_value text;
  from_club_id_value text;
  to_club_id_value text;
  player_id_value text;
  player_owner_value text;
  amount_value numeric;
  contract_years_value integer;
  seen_player_ids text[] := array[]::text[];
  player_leg_count integer := 0;
  normalized_legs jsonb := '[]'::jsonb;
begin
  if p_user_id is null then raise exception 'Verified user identity is required'; end if;
  if p_deal_id is null then raise exception 'Deal is required'; end if;
  if p_revision_no is null or p_revision_no < 1 then raise exception 'Exact deal revision is required'; end if;
  if action_value not in ('accept', 'decline', 'counter') then raise exception 'Response action must be accept, decline or counter'; end if;
  if trim(coalesce(p_request_key, '')) = '' then raise exception 'Request key is required'; end if;

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

  request_lock_key := pg_catalog.hashtextextended(concat_ws('|', p_world_id, p_deal_id::text), 0);
  perform pg_catalog.pg_advisory_xact_lock(request_lock_key);

  select * into existing_event
  from public.transfer_deal_events event
  where event.world_id = p_world_id
    and event.manager_id = manager_id_value
    and event.request_key = p_request_key
  limit 1;
  if existing_event.id is not null then
    select * into deal_row from public.transfer_deals where id = existing_event.deal_id;
    return jsonb_build_object('deal_id', deal_row.id, 'status', deal_row.status,
      'revision_no', deal_row.current_revision_no, 'idempotent', true);
  end if;

  select * into deal_row
  from public.transfer_deals deal
  where deal.id = p_deal_id and deal.world_id = p_world_id
  for update;
  if deal_row.id is null then raise exception 'Transfer deal was not found'; end if;
  if deal_row.status <> 'negotiating' then raise exception 'Only a negotiating deal can receive a response'; end if;
  if deal_row.current_revision_no <> p_revision_no then
    raise exception 'This offer revision is stale; refresh Transfers before responding';
  end if;

  if not exists (
    select 1 from public.transfer_deal_participants participant
    where participant.deal_id = deal_row.id and participant.club_id = club_id_value
  ) then raise exception 'Your club is not a participant in this transfer deal'; end if;

  select participant.club_id into counterpart_club_id_value
  from public.transfer_deal_participants participant
  where participant.deal_id = deal_row.id and participant.club_id <> club_id_value
  limit 1;
  if counterpart_club_id_value is null then raise exception 'Exchange counterpart club was not found'; end if;

  select * into current_revision
  from public.transfer_deal_revisions revision
  where revision.deal_id = deal_row.id and revision.revision_no = p_revision_no;
  if current_revision.id is null then raise exception 'Current exchange revision was not found'; end if;
  if coalesce(current_revision.summary->>'type', '') not in ('two_club_exchange_offer', 'two_club_exchange_counter') then
    raise exception 'This deal revision is not a two-club exchange';
  end if;

  if exists (
    select 1 from public.transfer_deal_approvals approval
    where approval.revision_id = current_revision.id and approval.club_id = club_id_value
  ) then raise exception 'Your club has already responded to this exact revision'; end if;

  if action_value = 'decline' then
    insert into public.transfer_deal_approvals(revision_id, club_id, manager_id, decision)
    values(current_revision.id, club_id_value, manager_id_value, 'declined');
    update public.transfer_deals
    set status = 'declined', terminal_reason = 'declined_by_participant', terminal_at = now(), updated_at = now()
    where id = deal_row.id returning * into deal_row;
    insert into public.transfer_deal_events(deal_id, world_id, manager_id, event_type, request_key, details)
    values(deal_row.id, p_world_id, manager_id_value, 'declined', p_request_key,
      jsonb_build_object('revision_no', p_revision_no, 'club_id', club_id_value, 'type', 'two_club_exchange'));
    return jsonb_build_object('deal_id', deal_row.id, 'status', deal_row.status, 'revision_no', p_revision_no);
  end if;

  if action_value = 'accept' then
    insert into public.transfer_deal_approvals(revision_id, club_id, manager_id, decision)
    values(current_revision.id, club_id_value, manager_id_value, 'approved');
    select count(*) into participant_count from public.transfer_deal_participants where deal_id = deal_row.id;
    select count(distinct approval.club_id) into approvals_count
    from public.transfer_deal_approvals approval
    where approval.revision_id = current_revision.id and approval.decision = 'approved';
    if participant_count >= 2 and approvals_count = participant_count then
      update public.transfer_deals set status = 'agreed', updated_at = now()
      where id = deal_row.id returning * into deal_row;
    end if;
    insert into public.transfer_deal_events(deal_id, world_id, manager_id, event_type, request_key, details)
    values(deal_row.id, p_world_id, manager_id_value, 'accepted', p_request_key,
      jsonb_build_object('revision_no', p_revision_no, 'club_id', club_id_value,
        'deal_status', deal_row.status, 'type', 'two_club_exchange'));
    return jsonb_build_object('deal_id', deal_row.id, 'status', deal_row.status, 'revision_no', p_revision_no);
  end if;

  if p_legs is null or jsonb_typeof(p_legs) <> 'array' or jsonb_array_length(p_legs) = 0 then
    raise exception 'A counter-offer requires the complete replacement leg set';
  end if;

  select save_checksum into canonical_checksum from public.canonical_world_saves where world_id = p_world_id limit 1;
  select * into cache_row from public.world_read_model_cache where world_id = p_world_id limit 1;
  if cache_row.read_model is null or canonical_checksum is null or cache_row.source_checksum <> canonical_checksum then
    raise exception 'World read model is refreshing; please retry shortly';
  end if;

  for leg_value, leg_ordinal in
    select value, ordinality from jsonb_array_elements(p_legs) with ordinality
  loop
    leg_type_value := lower(trim(coalesce(leg_value->>'leg_type', '')));
    from_club_id_value := trim(coalesce(leg_value->>'from_club_id', ''));
    to_club_id_value := trim(coalesce(leg_value->>'to_club_id', ''));
    if leg_type_value not in ('permanent_transfer', 'cash') then
      raise exception 'Two-club exchange counters support only permanent player and cash legs';
    end if;
    if from_club_id_value not in (club_id_value, counterpart_club_id_value)
       or to_club_id_value not in (club_id_value, counterpart_club_id_value)
       or from_club_id_value = to_club_id_value then
      raise exception 'Every exchange leg must move between the two participating clubs';
    end if;

    if leg_type_value = 'permanent_transfer' then
      player_id_value := trim(coalesce(leg_value->>'player_id', ''));
      if player_id_value = '' then raise exception 'Every permanent-transfer leg requires a player'; end if;
      if player_id_value = any(seen_player_ids) then raise exception 'The same player cannot appear more than once in an exchange revision'; end if;
      seen_player_ids := array_append(seen_player_ids, player_id_value);
      player_owner_value := coalesce(cache_row.read_model #>> array['squad_cycle','players',player_id_value,'club_id'], '');
      if player_owner_value = '' then raise exception 'Exchange player is not present in the canonical world'; end if;
      if player_owner_value <> from_club_id_value then raise exception 'Exchange player is not owned by the club offering that player'; end if;
      contract_years_value := case
        when coalesce(leg_value->>'contract_years', '') ~ '^[0-9]+$'
          then greatest(1, least((leg_value->>'contract_years')::integer, 5)) else 3 end;
      player_leg_count := player_leg_count + 1;
      normalized_legs := normalized_legs || jsonb_build_array(jsonb_build_object(
        'sequence_no', leg_ordinal, 'leg_type', 'permanent_transfer',
        'from_club_id', from_club_id_value, 'to_club_id', to_club_id_value,
        'player_id', player_id_value, 'contract_years', contract_years_value));
    else
      if coalesce(leg_value->>'amount', '') !~ '^[0-9]+([.][0-9]+)?$' then raise exception 'Every cash leg requires a numeric amount'; end if;
      amount_value := (leg_value->>'amount')::numeric;
      if amount_value <= 0 then raise exception 'Cash legs must be greater than zero'; end if;
      normalized_legs := normalized_legs || jsonb_build_array(jsonb_build_object(
        'sequence_no', leg_ordinal, 'leg_type', 'cash',
        'from_club_id', from_club_id_value, 'to_club_id', to_club_id_value, 'amount', amount_value));
    end if;
  end loop;
  if player_leg_count = 0 then raise exception 'An exchange counter must include at least one player'; end if;

  insert into public.transfer_deal_revisions(deal_id, revision_no, created_by_manager_id, summary)
  values(deal_row.id, p_revision_no + 1, manager_id_value,
    jsonb_build_object('type', 'two_club_exchange_counter', 'legs', normalized_legs,
      'player_leg_count', player_leg_count, 'supersedes_revision_no', p_revision_no))
  returning * into new_revision;

  for leg_value in select value from jsonb_array_elements(normalized_legs)
  loop
    if leg_value->>'leg_type' = 'permanent_transfer' then
      insert into public.transfer_deal_legs(revision_id, sequence_no, leg_type, from_club_id, to_club_id, player_id, terms)
      values(new_revision.id, (leg_value->>'sequence_no')::integer, 'permanent_transfer',
        leg_value->>'from_club_id', leg_value->>'to_club_id', leg_value->>'player_id',
        jsonb_build_object('contract_years', (leg_value->>'contract_years')::integer));
    else
      insert into public.transfer_deal_legs(revision_id, sequence_no, leg_type, from_club_id, to_club_id, amount)
      values(new_revision.id, (leg_value->>'sequence_no')::integer, 'cash',
        leg_value->>'from_club_id', leg_value->>'to_club_id', (leg_value->>'amount')::numeric);
    end if;
  end loop;

  insert into public.transfer_deal_approvals(revision_id, club_id, manager_id, decision)
  values(new_revision.id, club_id_value, manager_id_value, 'approved');
  update public.transfer_deals set current_revision_no = new_revision.revision_no, updated_at = now()
  where id = deal_row.id returning * into deal_row;
  insert into public.transfer_deal_events(deal_id, world_id, manager_id, event_type, request_key, details)
  values(deal_row.id, p_world_id, manager_id_value, 'countered', p_request_key,
    jsonb_build_object('from_revision_no', p_revision_no, 'revision_no', new_revision.revision_no,
      'club_id', club_id_value, 'type', 'two_club_exchange_counter', 'legs', normalized_legs));

  return jsonb_build_object('deal_id', deal_row.id, 'status', deal_row.status,
    'revision_no', new_revision.revision_no, 'legs', normalized_legs);
end;
$$;

revoke all on function public.respond_manager_transfer_exchange_deal_for_user(uuid,text,uuid,integer,text,jsonb,text)
  from public, anon, authenticated;
grant execute on function public.respond_manager_transfer_exchange_deal_for_user(uuid,text,uuid,integer,text,jsonb,text)
  to service_role;

commit;
