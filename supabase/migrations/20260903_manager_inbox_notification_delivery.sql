begin;

-- Keep the two manager-facing channels fed from authoritative lifecycle rows.
-- manager_messages is the dashboard inbox; manager_notifications is the bell.

create unique index if not exists manager_messages_free_agent_outcome_uidx
  on public.manager_messages ((metadata->>'free_agent_offer_outcome_key'))
  where metadata ? 'free_agent_offer_outcome_key';

create unique index if not exists manager_messages_appointment_welcome_uidx
  on public.manager_messages ((metadata->>'appointment_welcome_key'))
  where metadata ? 'appointment_welcome_key';

create or replace function public.emit_free_agent_offer_manager_outcome()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  title_value text;
  body_value text;
  class_value text := 'info';
  priority_value text := 'normal';
  outcome_key text;
begin
  if new.status not in ('accepted','rejected','application_failed','withdrawn')
     or new.status is not distinct from old.status then
    return new;
  end if;

  outcome_key := 'free_agent_offer:' || new.id::text || ':' || new.status;

  if new.status = 'accepted' then
    title_value := 'Free-agent offer accepted';
    body_value := new.player_name || ' accepted your contract offer.';
    class_value := 'reward';
    priority_value := 'high';
  elsif new.status = 'rejected' then
    title_value := 'Free-agent offer rejected';
    if coalesce(new.decision_reason,'') like 'terms_below_expectation%' then
      body_value := new.player_name || ' rejected your contract terms.';
    elsif coalesce(new.decision_reason,'') like 'player_chose_other_club%' then
      body_value := new.player_name || ' chose another club.';
    else
      body_value := new.player_name || ' did not accept your contract offer.';
    end if;
  elsif new.status = 'application_failed' then
    title_value := 'Free transfer could not be completed';
    class_value := 'action_required';
    priority_value := 'high';
    if coalesce(new.decision_reason,'') like 'Transfer window is closed at %' then
      body_value := new.player_name || ' accepted the terms, but the signing could not be completed because the transfer window is closed.';
    elsif new.decision_reason = 'manager_no_longer_controls_offer_club' then
      body_value := 'The offer for ' || new.player_name || ' could not be completed because you no longer control this club.';
    else
      body_value := 'The signing of ' || new.player_name || ' could not be completed. ' || coalesce(new.decision_reason, 'Please review the transfer screen.');
    end if;
  else
    title_value := 'Free-agent offer withdrawn';
    body_value := 'Your contract offer to ' || new.player_name || ' was withdrawn.';
  end if;

  insert into public.manager_messages(
    recipient_manager_id, club_id, message_type, subject, body,
    related_player_id, priority, metadata, created_at
  ) values (
    new.manager_id, new.club_id, 'free_agent', title_value, body_value,
    new.player_id, priority_value,
    jsonb_build_object(
      'free_agent_offer_id', new.id::text,
      'free_agent_offer_status', new.status,
      'free_agent_offer_outcome_key', outcome_key,
      'request_key', new.request_key
    ),
    coalesce(new.terminal_at, new.updated_at, now())
  ) on conflict do nothing;

  insert into public.manager_notifications(
    world_id, manager_id, notification_type, notification_class, title, body,
    action_url, source_type, source_id, dedupe_key, created_at
  ) values (
    new.world_id, new.manager_id, 'free_agent_' || new.status, class_value,
    title_value, body_value, '/?view=transfers', 'free_agent_offer', new.id::text,
    outcome_key, coalesce(new.terminal_at, new.updated_at, now())
  ) on conflict(manager_id, dedupe_key) do nothing;

  return new;
end;
$$;

revoke all on function public.emit_free_agent_offer_manager_outcome() from public, anon, authenticated;
grant execute on function public.emit_free_agent_offer_manager_outcome() to service_role;

drop trigger if exists free_agent_offer_manager_outcome on public.free_agent_offers;
create trigger free_agent_offer_manager_outcome
after update of status on public.free_agent_offers
for each row execute function public.emit_free_agent_offer_manager_outcome();

create or replace function public.emit_manager_appointment_welcome()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  club_name_value text;
  welcome_key text;
begin
  if new.status <> 'active' or new.control_type <> 'human' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = 'active' and old.club_id is not distinct from new.club_id then
    return new;
  end if;

  select coalesce(c.name, new.club_id) into club_name_value
  from public.clubs c where c.id = new.club_id limit 1;
  club_name_value := coalesce(club_name_value, new.club_id);
  welcome_key := 'appointment_welcome:' || new.id::text || ':' || new.club_id;

  insert into public.manager_messages(
    recipient_manager_id, club_id, message_type, subject, body, priority, metadata, created_at
  ) values (
    new.manager_id, new.club_id, 'appointment', 'Welcome to ' || club_name_value,
    'You are now in charge of ' || club_name_value || '. This inbox will carry important club, match and transfer updates.',
    'normal', jsonb_build_object('appointment_id',new.id::text,'appointment_welcome_key',welcome_key),
    coalesce(new.appointed_at, new.created_at, now())
  ) on conflict do nothing;

  insert into public.manager_notifications(
    world_id, manager_id, notification_type, notification_class, title, body,
    action_url, source_type, source_id, dedupe_key, created_at
  ) values (
    new.world_id, new.manager_id, 'manager_appointment', 'system', 'Welcome to ' || club_name_value,
    'You are now in charge of ' || club_name_value || '.', '/', 'manager_appointment', new.id::text,
    welcome_key, coalesce(new.appointed_at, new.created_at, now())
  ) on conflict(manager_id, dedupe_key) do nothing;

  return new;
end;
$$;

revoke all on function public.emit_manager_appointment_welcome() from public, anon, authenticated;
grant execute on function public.emit_manager_appointment_welcome() to service_role;

drop trigger if exists manager_appointment_welcome on public.manager_appointments;
create trigger manager_appointment_welcome
after insert or update of status, club_id on public.manager_appointments
for each row execute function public.emit_manager_appointment_welcome();

-- Backfill active human appointments so current alpha managers do not have an empty inbox.
insert into public.manager_messages(
  recipient_manager_id, club_id, message_type, subject, body, priority, metadata, created_at
)
select a.manager_id, a.club_id, 'appointment', 'Welcome to ' || coalesce(c.name,a.club_id),
       'You are now in charge of ' || coalesce(c.name,a.club_id) || '. This inbox will carry important club, match and transfer updates.',
       'normal', jsonb_build_object('appointment_id',a.id::text,'appointment_welcome_key','appointment_welcome:' || a.id::text || ':' || a.club_id),
       coalesce(a.appointed_at,a.created_at,now())
from public.manager_appointments a
left join public.clubs c on c.id=a.club_id
where a.status='active' and a.control_type='human'
on conflict do nothing;

insert into public.manager_notifications(
  world_id, manager_id, notification_type, notification_class, title, body,
  action_url, source_type, source_id, dedupe_key, created_at
)
select a.world_id, a.manager_id, 'manager_appointment', 'system', 'Welcome to ' || coalesce(c.name,a.club_id),
       'You are now in charge of ' || coalesce(c.name,a.club_id) || '.', '/', 'manager_appointment', a.id::text,
       'appointment_welcome:' || a.id::text || ':' || a.club_id, coalesce(a.appointed_at,a.created_at,now())
from public.manager_appointments a
left join public.clubs c on c.id=a.club_id
where a.status='active' and a.control_type='human'
on conflict(manager_id,dedupe_key) do nothing;

-- Backfill terminal free-agent offers, including outcomes that failed because the window was closed.
with terminal as (
  select f.*,
    'free_agent_offer:' || f.id::text || ':' || f.status as outcome_key,
    case
      when f.status='accepted' then 'Free-agent offer accepted'
      when f.status='rejected' then 'Free-agent offer rejected'
      when f.status='application_failed' then 'Free transfer could not be completed'
      else 'Free-agent offer withdrawn'
    end as title_value,
    case
      when f.status='accepted' then f.player_name || ' accepted your contract offer.'
      when f.status='rejected' and coalesce(f.decision_reason,'') like 'terms_below_expectation%' then f.player_name || ' rejected your contract terms.'
      when f.status='rejected' and coalesce(f.decision_reason,'') like 'player_chose_other_club%' then f.player_name || ' chose another club.'
      when f.status='rejected' then f.player_name || ' did not accept your contract offer.'
      when f.status='application_failed' and coalesce(f.decision_reason,'') like 'Transfer window is closed at %' then f.player_name || ' accepted the terms, but the signing could not be completed because the transfer window is closed.'
      when f.status='application_failed' then 'The signing of ' || f.player_name || ' could not be completed. ' || coalesce(f.decision_reason,'Please review the transfer screen.')
      else 'Your contract offer to ' || f.player_name || ' was withdrawn.'
    end as body_value
  from public.free_agent_offers f
  where f.status in ('accepted','rejected','application_failed','withdrawn')
)
insert into public.manager_messages(
  recipient_manager_id, club_id, message_type, subject, body, related_player_id, priority, metadata, created_at
)
select manager_id, club_id, 'free_agent', title_value, body_value, player_id,
       case when status in ('accepted','application_failed') then 'high' else 'normal' end,
       jsonb_build_object('free_agent_offer_id',id::text,'free_agent_offer_status',status,'free_agent_offer_outcome_key',outcome_key,'request_key',request_key),
       coalesce(terminal_at,updated_at,created_at)
from terminal
on conflict do nothing;

with terminal as (
  select f.*,
    'free_agent_offer:' || f.id::text || ':' || f.status as outcome_key,
    case
      when f.status='accepted' then 'Free-agent offer accepted'
      when f.status='rejected' then 'Free-agent offer rejected'
      when f.status='application_failed' then 'Free transfer could not be completed'
      else 'Free-agent offer withdrawn'
    end as title_value,
    case
      when f.status='accepted' then f.player_name || ' accepted your contract offer.'
      when f.status='rejected' and coalesce(f.decision_reason,'') like 'terms_below_expectation%' then f.player_name || ' rejected your contract terms.'
      when f.status='rejected' and coalesce(f.decision_reason,'') like 'player_chose_other_club%' then f.player_name || ' chose another club.'
      when f.status='rejected' then f.player_name || ' did not accept your contract offer.'
      when f.status='application_failed' and coalesce(f.decision_reason,'') like 'Transfer window is closed at %' then f.player_name || ' accepted the terms, but the signing could not be completed because the transfer window is closed.'
      when f.status='application_failed' then 'The signing of ' || f.player_name || ' could not be completed. ' || coalesce(f.decision_reason,'Please review the transfer screen.')
      else 'Your contract offer to ' || f.player_name || ' was withdrawn.'
    end as body_value
  from public.free_agent_offers f
  where f.status in ('accepted','rejected','application_failed','withdrawn')
)
insert into public.manager_notifications(
  world_id, manager_id, notification_type, notification_class, title, body,
  action_url, source_type, source_id, dedupe_key, created_at
)
select world_id, manager_id, 'free_agent_' || status,
       case when status='accepted' then 'reward' when status='application_failed' then 'action_required' else 'info' end,
       title_value, body_value, '/?view=transfers', 'free_agent_offer', id::text, outcome_key,
       coalesce(terminal_at,updated_at,created_at)
from terminal
on conflict(manager_id,dedupe_key) do nothing;

commit;
