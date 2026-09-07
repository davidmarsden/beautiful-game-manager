-- External-market deals are authored by the TBG system rather than a human manager.
-- Make the authoritative event journal support that actor cleanly and emit the same
-- action-required notification path as ordinary first-class offers.

begin;

alter table public.transfer_deal_events
  alter column manager_id drop not null;

-- Existing manager request keys remain protected by the original unique constraint.
-- System-authored events need their own idempotency key because NULL manager IDs do
-- not conflict under ordinary SQL unique semantics.
create unique index if not exists transfer_deal_events_system_request_uidx
  on public.transfer_deal_events(world_id, request_key)
  where manager_id is null;

create or replace function public.emit_transfer_deal_notification()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  recipient record;
  actor_club_id text;
  actor_club_name text;
  notification_type_value text;
  notification_class_value text;
  title_value text;
  body_value text;
  action_url_value text;
begin
  if new.event_type not in ('offered', 'countered', 'accepted', 'declined', 'settlement_completed') then
    return new;
  end if;

  -- `IS NOT DISTINCT FROM` deliberately treats NULL as the external/system actor.
  -- An external deal has one NULL-manager participant: the mirrored TPF buyer.
  select participant.club_id, coalesce(club.name, participant.club_id)
    into actor_club_id, actor_club_name
  from public.transfer_deal_participants participant
  left join public.clubs club
    on club.id = participant.club_id
   and club.world_id = new.world_id
  where participant.deal_id = new.deal_id
    and participant.manager_id is not distinct from new.manager_id
  order by case when participant.role = 'buyer' then 0 else 1 end
  limit 1;

  action_url_value := '/?view=transfers&deal=' || new.deal_id::text;

  if new.event_type = 'offered' then
    notification_type_value := 'transfer_offer_received';
    notification_class_value := 'action_required';
    title_value := 'Transfer offer received';
    body_value := coalesce(actor_club_name, 'Another club') || ' sent you a transfer offer.';
  elsif new.event_type = 'countered' then
    notification_type_value := 'transfer_counter_offer_received';
    notification_class_value := 'action_required';
    title_value := 'Counter-offer received';
    body_value := coalesce(actor_club_name, 'Another club') || ' sent you a counter-offer.';
  elsif new.event_type = 'accepted' then
    notification_type_value := 'transfer_offer_accepted';
    notification_class_value := 'info';
    title_value := 'Transfer offer accepted';
    body_value := coalesce(actor_club_name, 'The other club') || ' accepted the current transfer terms.';
  elsif new.event_type = 'declined' then
    notification_type_value := 'transfer_offer_rejected';
    notification_class_value := 'info';
    title_value := 'Transfer offer rejected';
    body_value := coalesce(actor_club_name, 'The other club') || ' rejected the current transfer terms.';
  else
    notification_type_value := 'transfer_completed';
    notification_class_value := 'info';
    title_value := 'Transfer completed';
    body_value := 'Your transfer has completed and the players and funds have been applied to the world.';
  end if;

  for recipient in
    select distinct participant.manager_id
    from public.transfer_deal_participants participant
    where participant.deal_id = new.deal_id
      and participant.manager_id is not null
      and (
        new.event_type = 'settlement_completed'
        or new.manager_id is null
        or participant.manager_id <> new.manager_id
      )
  loop
    insert into public.manager_notifications(
      world_id,
      manager_id,
      notification_type,
      notification_class,
      title,
      body,
      action_url,
      source_type,
      source_id,
      dedupe_key,
      created_at
    ) values (
      new.world_id,
      recipient.manager_id,
      notification_type_value,
      notification_class_value,
      title_value,
      body_value,
      action_url_value,
      'transfer_deal_event',
      new.id::text,
      'transfer_deal_event:' || new.id::text || ':' || notification_type_value,
      new.created_at
    ) on conflict(manager_id, dedupe_key) do nothing;
  end loop;

  return new;
end;
$$;

-- Emit the same authoritative `offered` event ordinary manager bids create when
-- the external buyer's system approval is inserted. This keeps inbox/notification
-- behaviour consistent without pretending a human manager authored the bid.
create or replace function public.emit_external_transfer_offered_event()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  deal_row public.transfer_deals;
  revision_no_value integer;
begin
  if new.manager_id is not null or new.decision <> 'approved' then
    return new;
  end if;

  select deal.* into deal_row
  from public.transfer_deals deal
  join public.transfer_deal_revisions revision on revision.deal_id = deal.id
  where revision.id = new.revision_id
    and deal.deal_origin = 'external_market'
  limit 1;

  if deal_row.id is null then return new; end if;

  select revision.revision_no into revision_no_value
  from public.transfer_deal_revisions revision
  where revision.id = new.revision_id;

  insert into public.transfer_deal_events(
    deal_id, world_id, manager_id, event_type, request_key, details
  ) values (
    deal_row.id,
    deal_row.world_id,
    null,
    'offered',
    'external-offer:' || deal_row.id::text || ':r' || revision_no_value::text,
    jsonb_build_object(
      'deal_origin', 'external_market',
      'external_club_source_id', deal_row.external_club_source_id,
      'external_club_name', deal_row.external_club_name,
      'revision_no', revision_no_value
    )
  ) on conflict do nothing;

  return new;
end;
$$;

drop trigger if exists external_transfer_offered_event on public.transfer_deal_approvals;
create trigger external_transfer_offered_event
after insert on public.transfer_deal_approvals
for each row execute function public.emit_external_transfer_offered_event();

revoke all on function public.emit_external_transfer_offered_event()
  from public, anon, authenticated;
grant execute on function public.emit_external_transfer_offered_event()
  to service_role;

commit;
