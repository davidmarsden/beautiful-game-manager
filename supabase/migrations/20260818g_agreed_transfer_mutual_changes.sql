-- #240 Slice B3: mutually amend or cancel agreed transfer deals before settlement.

begin;

create table if not exists public.transfer_deal_change_requests (
  id uuid primary key default gen_random_uuid(),
  world_id text not null,
  deal_id uuid not null references public.transfer_deals(id) on delete cascade,
  revision_no integer not null check (revision_no > 0),
  requested_by_club_id text not null,
  requested_by_manager_id uuid not null references public.manager_profiles(id) on delete restrict,
  change_type text not null check (change_type in ('amendment', 'cancellation')),
  proposed_fee numeric check (proposed_fee is null or proposed_fee >= 0),
  proposed_contract_years integer check (proposed_contract_years is null or proposed_contract_years between 1 and 5),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  request_key text not null,
  responded_by_club_id text,
  responded_by_manager_id uuid references public.manager_profiles(id) on delete restrict,
  response_request_key text,
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  unique(world_id, requested_by_manager_id, request_key),
  unique(world_id, responded_by_manager_id, response_request_key)
);

create unique index if not exists transfer_deal_one_pending_change_idx
  on public.transfer_deal_change_requests(deal_id)
  where status = 'pending';
create index if not exists transfer_deal_change_requests_world_idx
  on public.transfer_deal_change_requests(world_id, status, created_at desc);

alter table public.transfer_deal_change_requests enable row level security;
revoke all on table public.transfer_deal_change_requests from public, anon, authenticated;
grant select, insert, update on table public.transfer_deal_change_requests to service_role;

alter table public.transfer_deal_events
  drop constraint if exists transfer_deal_events_event_type_check;
alter table public.transfer_deal_events
  add constraint transfer_deal_events_event_type_check
  check (event_type in (
    'offered', 'withdrawn', 'accepted', 'declined', 'countered',
    'change_proposed', 'change_rejected', 'amended', 'mutually_cancelled'
  ));

create or replace function public.propose_manager_transfer_agreed_change_for_user(
  p_user_id uuid,
  p_world_id text,
  p_deal_id uuid,
  p_revision_no integer,
  p_change_type text,
  p_fee numeric default null,
  p_contract_years integer default null,
  p_request_key text default null
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  manager_id_value uuid;
  club_id_value text;
  change_type_value text := lower(trim(coalesce(p_change_type, '')));
  deal_row public.transfer_deals;
  participant public.transfer_deal_participants;
  existing_request public.transfer_deal_change_requests;
  change_row public.transfer_deal_change_requests;
  request_lock_key bigint;
  fee_value numeric;
  contract_years_value integer;
begin
  if p_user_id is null then raise exception 'Verified user identity is required'; end if;
  if p_deal_id is null then raise exception 'Deal is required'; end if;
  if p_revision_no is null or p_revision_no < 1 then raise exception 'Exact agreed revision is required'; end if;
  if change_type_value not in ('amendment', 'cancellation') then raise exception 'Agreed-deal change must be amendment or cancellation'; end if;
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

  select * into existing_request
  from public.transfer_deal_change_requests request
  where request.world_id = p_world_id
    and request.requested_by_manager_id = manager_id_value
    and request.request_key = p_request_key
  limit 1;
  if existing_request.id is not null then
    return jsonb_build_object('change_request_id', existing_request.id, 'status', existing_request.status, 'idempotent', true);
  end if;

  request_lock_key := pg_catalog.hashtextextended(concat_ws('|', p_world_id, p_deal_id::text), 0);
  perform pg_catalog.pg_advisory_xact_lock(request_lock_key);

  select * into deal_row
  from public.transfer_deals deal
  where deal.id = p_deal_id and deal.world_id = p_world_id
  for update;
  if deal_row.id is null then raise exception 'Transfer deal was not found'; end if;
  if deal_row.status <> 'agreed' then raise exception 'Only an agreed transfer deal can be amended or mutually cancelled'; end if;
  if deal_row.current_revision_no <> p_revision_no then raise exception 'This agreed transfer revision is stale; refresh Transfers before proposing a change'; end if;

  select * into participant
  from public.transfer_deal_participants p
  where p.deal_id = deal_row.id and p.club_id = club_id_value;
  if participant.deal_id is null then raise exception 'Your club is not a participant in this transfer deal'; end if;

  if exists (
    select 1 from public.transfer_deal_change_requests request
    where request.deal_id = deal_row.id and request.status = 'pending'
  ) then
    raise exception 'This agreed transfer already has a pending change request';
  end if;

  if change_type_value = 'amendment' then
    fee_value := greatest(coalesce(p_fee, 0), 0);
    contract_years_value := greatest(1, least(coalesce(p_contract_years, 3), 5));
  else
    fee_value := null;
    contract_years_value := null;
  end if;

  insert into public.transfer_deal_change_requests(
    world_id, deal_id, revision_no, requested_by_club_id, requested_by_manager_id,
    change_type, proposed_fee, proposed_contract_years, request_key
  ) values (
    p_world_id, deal_row.id, p_revision_no, club_id_value, manager_id_value,
    change_type_value, fee_value, contract_years_value, p_request_key
  ) returning * into change_row;

  insert into public.transfer_deal_events(deal_id, world_id, manager_id, event_type, request_key, details)
  values(
    deal_row.id, p_world_id, manager_id_value, 'change_proposed', p_request_key,
    jsonb_build_object(
      'change_request_id', change_row.id,
      'revision_no', p_revision_no,
      'club_id', club_id_value,
      'change_type', change_type_value,
      'fee', fee_value,
      'contract_years', contract_years_value
    )
  );

  return jsonb_build_object(
    'change_request_id', change_row.id,
    'deal_id', deal_row.id,
    'revision_no', p_revision_no,
    'change_type', change_type_value,
    'status', change_row.status
  );
end;
$$;

create or replace function public.respond_manager_transfer_agreed_change_for_user(
  p_user_id uuid,
  p_world_id text,
  p_change_request_id uuid,
  p_action text,
  p_request_key text default null
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  manager_id_value uuid;
  club_id_value text;
  action_value text := lower(trim(coalesce(p_action, '')));
  change_row public.transfer_deal_change_requests;
  existing_response public.transfer_deal_change_requests;
  deal_row public.transfer_deals;
  requester public.transfer_deal_participants;
  responder public.transfer_deal_participants;
  current_revision public.transfer_deal_revisions;
  new_revision public.transfer_deal_revisions;
  player_leg public.transfer_deal_legs;
  fee_value numeric;
  contract_years_value integer;
  request_lock_key bigint;
begin
  if p_user_id is null then raise exception 'Verified user identity is required'; end if;
  if p_change_request_id is null then raise exception 'Change request is required'; end if;
  if action_value not in ('accept', 'reject') then raise exception 'Change response must be accept or reject'; end if;
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

  select * into existing_response
  from public.transfer_deal_change_requests request
  where request.world_id = p_world_id
    and request.responded_by_manager_id = manager_id_value
    and request.response_request_key = p_request_key
  limit 1;
  if existing_response.id is not null then
    return jsonb_build_object('change_request_id', existing_response.id, 'status', existing_response.status, 'idempotent', true);
  end if;

  select * into change_row
  from public.transfer_deal_change_requests request
  where request.id = p_change_request_id and request.world_id = p_world_id;
  if change_row.id is null then raise exception 'Agreed-deal change request was not found'; end if;

  request_lock_key := pg_catalog.hashtextextended(concat_ws('|', p_world_id, change_row.deal_id::text), 0);
  perform pg_catalog.pg_advisory_xact_lock(request_lock_key);

  select * into change_row
  from public.transfer_deal_change_requests request
  where request.id = p_change_request_id and request.world_id = p_world_id
  for update;
  if change_row.status <> 'pending' then raise exception 'This agreed-deal change request is no longer pending'; end if;
  if change_row.requested_by_club_id = club_id_value then raise exception 'The proposing club cannot approve its own agreed-deal change'; end if;

  select * into deal_row
  from public.transfer_deals deal
  where deal.id = change_row.deal_id and deal.world_id = p_world_id
  for update;
  if deal_row.id is null then raise exception 'Transfer deal was not found'; end if;
  if deal_row.status <> 'agreed' then raise exception 'Only an agreed transfer deal can receive a mutual change response'; end if;
  if deal_row.current_revision_no <> change_row.revision_no then raise exception 'The agreed transfer changed after this request was proposed; refresh Transfers'; end if;

  select * into responder
  from public.transfer_deal_participants p
  where p.deal_id = deal_row.id and p.club_id = club_id_value;
  if responder.deal_id is null then raise exception 'Your club is not a participant in this transfer deal'; end if;
  select * into requester
  from public.transfer_deal_participants p
  where p.deal_id = deal_row.id and p.club_id = change_row.requested_by_club_id;
  if requester.deal_id is null then raise exception 'The proposing club is not a participant in this transfer deal'; end if;

  if action_value = 'reject' then
    update public.transfer_deal_change_requests
    set status = 'rejected', responded_by_club_id = club_id_value,
        responded_by_manager_id = manager_id_value, response_request_key = p_request_key,
        responded_at = now()
    where id = change_row.id
    returning * into change_row;

    insert into public.transfer_deal_events(deal_id, world_id, manager_id, event_type, request_key, details)
    values(
      deal_row.id, p_world_id, manager_id_value, 'change_rejected', p_request_key,
      jsonb_build_object('change_request_id', change_row.id, 'revision_no', change_row.revision_no, 'change_type', change_row.change_type, 'club_id', club_id_value)
    );

    return jsonb_build_object('change_request_id', change_row.id, 'deal_id', deal_row.id, 'status', change_row.status, 'deal_status', deal_row.status);
  end if;

  if change_row.change_type = 'cancellation' then
    update public.transfer_deals
    set status = 'mutually_cancelled', terminal_reason = 'revoked_by_mutual_consent', terminal_at = now(), updated_at = now()
    where id = deal_row.id
    returning * into deal_row;

    update public.transfer_deal_change_requests
    set status = 'accepted', responded_by_club_id = club_id_value,
        responded_by_manager_id = manager_id_value, response_request_key = p_request_key,
        responded_at = now()
    where id = change_row.id
    returning * into change_row;

    insert into public.transfer_deal_events(deal_id, world_id, manager_id, event_type, request_key, details)
    values(
      deal_row.id, p_world_id, manager_id_value, 'mutually_cancelled', p_request_key,
      jsonb_build_object('change_request_id', change_row.id, 'revision_no', change_row.revision_no, 'proposed_by_club_id', change_row.requested_by_club_id, 'accepted_by_club_id', club_id_value)
    );

    return jsonb_build_object('change_request_id', change_row.id, 'deal_id', deal_row.id, 'status', change_row.status, 'deal_status', deal_row.status);
  end if;

  select * into current_revision
  from public.transfer_deal_revisions revision
  where revision.deal_id = deal_row.id and revision.revision_no = deal_row.current_revision_no;
  if current_revision.id is null then raise exception 'Current agreed transfer revision was not found'; end if;

  select * into player_leg
  from public.transfer_deal_legs leg
  where leg.revision_id = current_revision.id and leg.leg_type = 'permanent_transfer'
  order by leg.sequence_no asc limit 1;
  if player_leg.id is null then raise exception 'Agreed transfer revision does not contain a player leg'; end if;

  fee_value := greatest(coalesce(change_row.proposed_fee, 0), 0);
  contract_years_value := greatest(1, least(coalesce(change_row.proposed_contract_years, 3), 5));

  insert into public.transfer_deal_revisions(deal_id, revision_no, created_by_manager_id, summary)
  values(
    deal_row.id,
    deal_row.current_revision_no + 1,
    change_row.requested_by_manager_id,
    jsonb_build_object(
      'type', 'mutual_agreed_amendment',
      'player_id', player_leg.player_id,
      'fee', fee_value,
      'contract_years', contract_years_value,
      'supersedes_revision_no', deal_row.current_revision_no,
      'change_request_id', change_row.id
    )
  ) returning * into new_revision;

  insert into public.transfer_deal_legs(revision_id, sequence_no, leg_type, from_club_id, to_club_id, player_id, terms)
  values(new_revision.id, 1, 'permanent_transfer', player_leg.from_club_id, player_leg.to_club_id, player_leg.player_id,
    jsonb_build_object('contract_years', contract_years_value));
  if fee_value > 0 then
    insert into public.transfer_deal_legs(revision_id, sequence_no, leg_type, from_club_id, to_club_id, amount)
    values(new_revision.id, 2, 'cash', player_leg.to_club_id, player_leg.from_club_id, fee_value);
  end if;

  insert into public.transfer_deal_approvals(revision_id, club_id, manager_id, decision) values
    (new_revision.id, change_row.requested_by_club_id, change_row.requested_by_manager_id, 'approved'),
    (new_revision.id, club_id_value, manager_id_value, 'approved');

  update public.transfer_deals
  set current_revision_no = new_revision.revision_no, updated_at = now()
  where id = deal_row.id
  returning * into deal_row;

  update public.transfer_deal_change_requests
  set status = 'accepted', responded_by_club_id = club_id_value,
      responded_by_manager_id = manager_id_value, response_request_key = p_request_key,
      responded_at = now()
  where id = change_row.id
  returning * into change_row;

  insert into public.transfer_deal_events(deal_id, world_id, manager_id, event_type, request_key, details)
  values(
    deal_row.id, p_world_id, manager_id_value, 'amended', p_request_key,
    jsonb_build_object(
      'change_request_id', change_row.id,
      'from_revision_no', change_row.revision_no,
      'revision_no', new_revision.revision_no,
      'fee', fee_value,
      'contract_years', contract_years_value,
      'proposed_by_club_id', change_row.requested_by_club_id,
      'accepted_by_club_id', club_id_value
    )
  );

  return jsonb_build_object(
    'change_request_id', change_row.id,
    'deal_id', deal_row.id,
    'status', change_row.status,
    'deal_status', deal_row.status,
    'revision_no', new_revision.revision_no
  );
end;
$$;

create or replace function public.get_manager_transfer_agreed_changes_for_user(
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

  select coalesce(jsonb_agg(jsonb_build_object(
    'change_request_id', request.id,
    'deal_id', request.deal_id,
    'revision_no', request.revision_no,
    'change_type', request.change_type,
    'proposed_fee', request.proposed_fee,
    'proposed_contract_years', request.proposed_contract_years,
    'requested_by_club_id', request.requested_by_club_id,
    'requested_by_you', request.requested_by_club_id = club_id_value,
    'status', request.status,
    'created_at', request.created_at
  ) order by request.created_at desc), '[]'::jsonb)
  into result_value
  from public.transfer_deal_change_requests request
  join public.transfer_deals deal on deal.id = request.deal_id
  where request.world_id = p_world_id
    and request.status = 'pending'
    and deal.status = 'agreed'
    and exists (
      select 1 from public.transfer_deal_participants participant
      where participant.deal_id = deal.id and participant.club_id = club_id_value
    );

  return result_value;
end;
$$;

revoke all on function public.propose_manager_transfer_agreed_change_for_user(uuid,text,uuid,integer,text,numeric,integer,text)
  from public, anon, authenticated;
grant execute on function public.propose_manager_transfer_agreed_change_for_user(uuid,text,uuid,integer,text,numeric,integer,text)
  to service_role;

revoke all on function public.respond_manager_transfer_agreed_change_for_user(uuid,text,uuid,text,text)
  from public, anon, authenticated;
grant execute on function public.respond_manager_transfer_agreed_change_for_user(uuid,text,uuid,text,text)
  to service_role;

revoke all on function public.get_manager_transfer_agreed_changes_for_user(uuid,text)
  from public, anon, authenticated;
grant execute on function public.get_manager_transfer_agreed_changes_for_user(uuid,text)
  to service_role;

commit;
