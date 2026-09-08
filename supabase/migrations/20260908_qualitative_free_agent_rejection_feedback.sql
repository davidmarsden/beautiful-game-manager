begin;

-- Keep free-agent negotiations readable without exposing the hidden wage model.
-- Managers can now inspect player wages across squads, so rejection feedback
-- should explain the shape of the decision without publishing expected_wage,
-- score thresholds, or any other answer-key value.

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
      body_value := new.player_name || ' felt your contract terms fell short of expectations.';
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

commit;
