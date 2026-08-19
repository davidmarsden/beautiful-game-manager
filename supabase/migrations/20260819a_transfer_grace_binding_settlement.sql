-- #240 Slice C1: mistake grace, effective binding and CAS-safe straight-transfer settlement.

begin;

alter table public.transfer_deals
  add column if not exists settlement_previous_checksum text,
  add column if not exists settlement_replacement_checksum text,
  add column if not exists settlement_error text,
  add column if not exists settlement_attempts integer not null default 0;

alter table public.transfer_deal_events
  drop constraint if exists transfer_deal_events_event_type_check;
alter table public.transfer_deal_events
  add constraint transfer_deal_events_event_type_check
  check (event_type in (
    'offered', 'withdrawn', 'accepted', 'declined', 'countered',
    'change_proposed', 'change_rejected', 'amended', 'mutually_cancelled',
    'cancelled_in_grace', 'settlement_completed', 'application_failed'
  ));

create or replace function public.schedule_transfer_deal_lifecycle()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  anchor_at timestamptz;
begin
  if new.status = 'agreed' and (
    old.status is distinct from 'agreed'
    or old.current_revision_no is distinct from new.current_revision_no
    or new.grace_expires_at is null
    or new.settle_at is null
  ) then
    anchor_at := coalesce(new.updated_at, now());
    new.grace_expires_at := anchor_at + interval '15 minutes';
    new.binding_at := anchor_at + interval '15 minutes';
    new.settle_at := anchor_at + interval '3 hours';
    new.settlement_previous_checksum := null;
    new.settlement_replacement_checksum := null;
    new.settlement_error := null;
    new.settlement_attempts := 0;
  end if;
  return new;
end;
$$;

drop trigger if exists transfer_deal_lifecycle_schedule on public.transfer_deals;
create trigger transfer_deal_lifecycle_schedule
before update of status, current_revision_no on public.transfer_deals
for each row execute function public.schedule_transfer_deal_lifecycle();

-- Existing live agreed deals predate Slice C. Honour their original agreement timestamp.
update public.transfer_deals
set grace_expires_at = coalesce(grace_expires_at, updated_at + interval '15 minutes'),
    binding_at = coalesce(binding_at, updated_at + interval '15 minutes'),
    settle_at = coalesce(settle_at, updated_at + interval '3 hours')
where status = 'agreed';

create index if not exists transfer_deals_due_settlement_idx
  on public.transfer_deals(world_id, settle_at)
  where status = 'agreed';

create or replace function public.get_manager_transfer_lifecycle_for_user(
  p_user_id uuid,
  p_world_id text
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  club_id_value text;
  result_value jsonb;
begin
  select appointment.club_id
    into club_id_value
  from public.manager_profiles profile
  join public.manager_appointments appointment
    on appointment.manager_id = profile.id
   and appointment.world_id = p_world_id
   and appointment.status = 'active'
  where profile.user_id = p_user_id
  limit 1;

  if club_id_value is null then raise exception 'No active manager appointment for this user and world'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'deal_id', deal.id,
    'status', deal.status,
    'effective_state', case
      when deal.status <> 'agreed' then deal.status
      when now() < coalesce(deal.grace_expires_at, '-infinity'::timestamptz) then 'grace_period'
      else 'binding'
    end,
    'grace_expires_at', deal.grace_expires_at,
    'binding_at', deal.binding_at,
    'settle_at', deal.settle_at,
    'can_cancel_in_grace', deal.status = 'agreed' and now() < coalesce(deal.grace_expires_at, '-infinity'::timestamptz),
    'settlement_error', deal.settlement_error
  ) order by deal.updated_at desc), '[]'::jsonb)
  into result_value
  from public.transfer_deals deal
  where deal.world_id = p_world_id
    and deal.status in ('agreed', 'completed', 'application_failed', 'cancelled_in_grace', 'mutually_cancelled')
    and exists (
      select 1 from public.transfer_deal_participants participant
      where participant.deal_id = deal.id and participant.club_id = club_id_value
    );

  return result_value;
end;
$$;

create or replace function public.cancel_manager_transfer_deal_in_grace_for_user(
  p_user_id uuid,
  p_world_id text,
  p_deal_id uuid,
  p_request_key text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  manager_id_value uuid;
  club_id_value text;
  deal_row public.transfer_deals;
  existing_event public.transfer_deal_events;
  request_lock_key bigint;
begin
  if p_user_id is null then raise exception 'Verified user identity is required'; end if;
  if p_deal_id is null then raise exception 'Deal is required'; end if;
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
    return jsonb_build_object('deal_id', deal_row.id, 'status', deal_row.status, 'idempotent', true);
  end if;

  select * into deal_row
  from public.transfer_deals deal
  where deal.id = p_deal_id and deal.world_id = p_world_id
  for update;
  if deal_row.id is null then raise exception 'Transfer deal was not found'; end if;
  if deal_row.status <> 'agreed' then raise exception 'Only an agreed transfer can be cancelled during mistake grace'; end if;
  if now() >= coalesce(deal_row.grace_expires_at, '-infinity'::timestamptz) then
    raise exception 'The unilateral mistake-grace period has expired; cancellation now requires mutual consent';
  end if;
  if not exists (
    select 1 from public.transfer_deal_participants participant
    where participant.deal_id = deal_row.id and participant.club_id = club_id_value
  ) then raise exception 'Your club is not a participant in this transfer deal'; end if;

  update public.transfer_deals
  set status = 'cancelled_in_grace',
      terminal_reason = 'cancelled_during_mistake_grace',
      terminal_at = now(),
      updated_at = now()
  where id = deal_row.id
  returning * into deal_row;

  insert into public.transfer_deal_events(deal_id, world_id, manager_id, event_type, request_key, details)
  values(deal_row.id, p_world_id, manager_id_value, 'cancelled_in_grace', p_request_key,
    jsonb_build_object('club_id', club_id_value, 'revision_no', deal_row.current_revision_no));

  return jsonb_build_object('deal_id', deal_row.id, 'status', deal_row.status);
end;
$$;

create or replace function public.get_due_transfer_settlements(
  p_world_id text default null,
  p_limit integer default 10
) returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce(jsonb_agg(row_value order by (row_value->>'settle_at')::timestamptz asc), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'deal_id', deal.id,
      'world_id', deal.world_id,
      'revision_no', deal.current_revision_no,
      'settle_at', deal.settle_at,
      'player_id', player_leg.player_id,
      'from_club_id', player_leg.from_club_id,
      'to_club_id', player_leg.to_club_id,
      'contract_years', case when coalesce(player_leg.terms->>'contract_years', '') ~ '^[0-9]+$'
        then greatest(1, least((player_leg.terms->>'contract_years')::integer, 5)) else 3 end,
      'fee', coalesce(cash_leg.amount, 0)
    ) as row_value
    from public.transfer_deals deal
    join public.transfer_deal_revisions revision
      on revision.deal_id = deal.id and revision.revision_no = deal.current_revision_no
    join public.transfer_deal_legs player_leg
      on player_leg.revision_id = revision.id and player_leg.leg_type = 'permanent_transfer'
    left join public.transfer_deal_legs cash_leg
      on cash_leg.revision_id = revision.id and cash_leg.leg_type = 'cash'
    where deal.status = 'agreed'
      and deal.settle_at is not null
      and deal.settle_at <= now()
      and (p_world_id is null or deal.world_id = p_world_id)
    order by deal.settle_at asc
    limit greatest(1, least(coalesce(p_limit, 10), 50))
  ) due;
$$;

create or replace function public.apply_transfer_deal_settlement(
  p_deal_id uuid,
  p_expected_checksum text,
  p_replacement jsonb
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  deal_row public.transfer_deals;
  world_row public.canonical_world_saves;
  replacement_checksum text := p_replacement->>'save_checksum';
  request_key_value text;
begin
  if p_deal_id is null then raise exception 'Deal is required'; end if;
  if trim(coalesce(p_expected_checksum, '')) = '' then raise exception 'Expected canonical checksum is required'; end if;
  if trim(coalesce(replacement_checksum, '')) = '' then raise exception 'Replacement checksum is required'; end if;

  select * into deal_row
  from public.transfer_deals
  where id = p_deal_id
  for update;
  if deal_row.id is null then return jsonb_build_object('accepted', false, 'reason', 'deal_not_found'); end if;
  if deal_row.status = 'completed' then
    return jsonb_build_object(
      'accepted', deal_row.settlement_replacement_checksum = replacement_checksum,
      'reason', 'already_completed',
      'deal_id', deal_row.id,
      'replacement_checksum', deal_row.settlement_replacement_checksum
    );
  end if;
  if deal_row.status <> 'agreed' then return jsonb_build_object('accepted', false, 'reason', 'deal_not_settleable'); end if;
  if deal_row.settle_at is null or deal_row.settle_at > now() then return jsonb_build_object('accepted', false, 'reason', 'settlement_not_due'); end if;

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
  where world_id = deal_row.world_id
    and save_checksum = p_expected_checksum
    and turn_status = 'open'
  returning * into world_row;

  if world_row.world_id is null then
    return jsonb_build_object('accepted', false, 'reason', 'checkpoint_changed_or_busy');
  end if;

  insert into public.world_read_model_cache(world_id, source_checksum, read_model, refreshed_at)
  values(deal_row.world_id, replacement_checksum, p_replacement->'save_envelope'->'world', now())
  on conflict (world_id) do update
    set source_checksum = excluded.source_checksum,
        read_model = excluded.read_model,
        refreshed_at = excluded.refreshed_at;

  update public.transfer_deals
  set status = 'completed',
      settlement_previous_checksum = p_expected_checksum,
      settlement_replacement_checksum = replacement_checksum,
      settlement_error = null,
      settlement_attempts = settlement_attempts + 1,
      terminal_reason = 'settled_to_canonical_world',
      terminal_at = now(),
      updated_at = now()
  where id = deal_row.id
  returning * into deal_row;

  if deal_row.listing_id is not null then
    update public.transfer_market_listings
    set status = 'withdrawn', withdrawn_at = coalesce(withdrawn_at, now()), updated_at = now()
    where id = deal_row.listing_id and status = 'active';
  end if;

  request_key_value := concat('settlement:', replacement_checksum);
  insert into public.transfer_deal_events(deal_id, world_id, manager_id, event_type, request_key, details)
  values(
    deal_row.id,
    deal_row.world_id,
    deal_row.created_by_manager_id,
    'settlement_completed',
    request_key_value,
    jsonb_build_object(
      'revision_no', deal_row.current_revision_no,
      'previous_checksum', p_expected_checksum,
      'replacement_checksum', replacement_checksum
    )
  ) on conflict (world_id, manager_id, request_key) do nothing;

  return jsonb_build_object(
    'accepted', true,
    'deal_id', deal_row.id,
    'status', deal_row.status,
    'previous_checksum', p_expected_checksum,
    'replacement_checksum', replacement_checksum
  );
end;
$$;

create or replace function public.fail_transfer_deal_application(
  p_deal_id uuid,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  deal_row public.transfer_deals;
  reason_value text := left(trim(coalesce(p_reason, 'Transfer settlement validation failed')), 1000);
begin
  select * into deal_row from public.transfer_deals where id = p_deal_id for update;
  if deal_row.id is null then return jsonb_build_object('accepted', false, 'reason', 'deal_not_found'); end if;
  if deal_row.status <> 'agreed' then return jsonb_build_object('accepted', false, 'reason', 'deal_not_settleable'); end if;

  update public.transfer_deals
  set status = 'application_failed',
      settlement_error = reason_value,
      settlement_attempts = settlement_attempts + 1,
      terminal_reason = 'canonical_validation_failed',
      terminal_at = now(),
      updated_at = now()
  where id = deal_row.id
  returning * into deal_row;

  insert into public.transfer_deal_events(deal_id, world_id, manager_id, event_type, request_key, details)
  values(
    deal_row.id,
    deal_row.world_id,
    deal_row.created_by_manager_id,
    'application_failed',
    concat('application-failed:', deal_row.id::text, ':', deal_row.settlement_attempts::text),
    jsonb_build_object('revision_no', deal_row.current_revision_no, 'reason', reason_value)
  ) on conflict (world_id, manager_id, request_key) do nothing;

  return jsonb_build_object('accepted', true, 'deal_id', deal_row.id, 'status', deal_row.status, 'reason', reason_value);
end;
$$;

revoke all on function public.get_manager_transfer_lifecycle_for_user(uuid,text) from public, anon, authenticated;
grant execute on function public.get_manager_transfer_lifecycle_for_user(uuid,text) to service_role;
revoke all on function public.cancel_manager_transfer_deal_in_grace_for_user(uuid,text,uuid,text) from public, anon, authenticated;
grant execute on function public.cancel_manager_transfer_deal_in_grace_for_user(uuid,text,uuid,text) to service_role;
revoke all on function public.get_due_transfer_settlements(text,integer) from public, anon, authenticated;
grant execute on function public.get_due_transfer_settlements(text,integer) to service_role;
revoke all on function public.apply_transfer_deal_settlement(uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.apply_transfer_deal_settlement(uuid,text,jsonb) to service_role;
revoke all on function public.fail_transfer_deal_application(uuid,text) from public, anon, authenticated;
grant execute on function public.fail_transfer_deal_application(uuid,text) to service_role;

commit;
