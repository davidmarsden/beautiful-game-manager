begin;

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

  select participant.club_id, coalesce(club.name, participant.club_id)
    into actor_club_id, actor_club_name
  from public.transfer_deal_participants participant
  left join public.clubs club
    on club.id = participant.club_id
   and club.world_id = new.world_id
  where participant.deal_id = new.deal_id
    and participant.manager_id = new.manager_id
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

revoke all on function public.emit_transfer_deal_notification() from public, anon, authenticated;
grant execute on function public.emit_transfer_deal_notification() to service_role;

drop trigger if exists transfer_deal_manager_notifications on public.transfer_deal_events;
create trigger transfer_deal_manager_notifications
after insert on public.transfer_deal_events
for each row execute function public.emit_transfer_deal_notification();

comment on function public.emit_transfer_deal_notification() is
  'Emits deduplicated manager_notifications from authoritative transfer_deal_events. Offers and counters are action-required for the other participant; accept/reject notify the other side; settlement completion notifies all participating managers.';

commit;
