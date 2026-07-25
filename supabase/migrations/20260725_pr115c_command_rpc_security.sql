-- PR #115 follow-up: lock command RPCs to the authenticated appointment and trusted scheduler.

begin;

create or replace function public.submit_manager_world_command(
  p_world_id text,
  p_manager_id uuid,
  p_club_id text,
  p_command_type text,
  p_command_payload jsonb,
  p_effective_season_id text,
  p_effective_matchday integer,
  p_request_key text
) returns public.manager_world_commands
language plpgsql
security definer
set search_path = public
as $$
declare
  existing public.manager_world_commands;
  inserted public.manager_world_commands;
  subject_key text;
  submitted_at_value timestamptz := now();
begin
  if p_manager_id <> public.current_manager_id() then
    raise exception 'Manager identity does not match the authenticated session';
  end if;

  if not exists (
    select 1
    from public.manager_appointments appointment
    where appointment.manager_id = p_manager_id
      and appointment.world_id = p_world_id
      and appointment.club_id = p_club_id
      and appointment.status = 'active'
  ) then
    raise exception 'Command does not match an active manager appointment';
  end if;

  select * into existing
  from public.manager_world_commands
  where world_id = p_world_id
    and manager_id = p_manager_id
    and request_key = p_request_key;
  if found then return existing; end if;

  subject_key := public.manager_command_subject_key(p_command_type, p_command_payload);

  insert into public.manager_world_commands (
    world_id, manager_id, club_id, command_type, command_payload, status,
    effective_season_id, effective_matchday, submitted_at, request_key,
    negotiation_state
  ) values (
    p_world_id, p_manager_id, p_club_id, p_command_type, p_command_payload, 'pending',
    p_effective_season_id, p_effective_matchday, submitted_at_value, p_request_key,
    case
      when p_command_type = 'transfer_offer' then 'offer_submitted'
      when p_command_type = 'transfer_listing' then 'listed'
      when p_command_type = 'transfer_response' then coalesce(p_command_payload->>'response', 'response_submitted')
      else null
    end
  ) returning * into inserted;

  update public.manager_world_commands older
  set status = 'superseded',
      superseded_by = inserted.id,
      processed_at = submitted_at_value,
      terminal_at = submitted_at_value,
      outcome_reason = 'Replaced by a newer request for the same player and workflow.',
      outcome_details = jsonb_build_object('superseded_by', inserted.id, 'subject_key', subject_key),
      final_outcome_key = 'command:' || older.id::text || ':superseded'
  where older.world_id = p_world_id
    and older.manager_id = p_manager_id
    and older.id <> inserted.id
    and older.status = 'pending'
    and public.manager_command_subject_key(older.command_type, older.command_payload) = subject_key;

  insert into public.manager_command_audit (
    command_id, world_id, manager_id, club_id, outcome_status, outcome_reason, outcome_details, outcome_key
  )
  select older.id, older.world_id, older.manager_id, older.club_id, 'superseded',
         older.outcome_reason, older.outcome_details, older.final_outcome_key
  from public.manager_world_commands older
  where older.superseded_by = inserted.id
  on conflict (command_id) do nothing;

  insert into public.manager_messages (
    recipient_manager_id, club_id, message_type, subject, body, priority, metadata, created_at
  )
  select older.manager_id, older.club_id, 'world_command_outcome',
         'Request superseded', older.outcome_reason, 'normal',
         jsonb_build_object('command_id', older.id, 'command_outcome_key', older.final_outcome_key),
         submitted_at_value
  from public.manager_world_commands older
  where older.superseded_by = inserted.id
  on conflict do nothing;

  return inserted;
end;
$$;

revoke all on function public.submit_manager_world_command(text, uuid, text, text, jsonb, text, integer, text) from public;
revoke all on function public.submit_manager_world_command(text, uuid, text, text, jsonb, text, integer, text) from anon;
grant execute on function public.submit_manager_world_command(text, uuid, text, text, jsonb, text, integer, text) to authenticated;

drop function if exists public.finalize_manager_world_command(uuid, text, text, jsonb, text, text, text, timestamptz);

revoke all on function public.finalize_manager_world_command(uuid, text, text, jsonb, text, text, text, timestamptz, text) from public;
revoke all on function public.finalize_manager_world_command(uuid, text, text, jsonb, text, text, text, timestamptz, text) from anon;
revoke all on function public.finalize_manager_world_command(uuid, text, text, jsonb, text, text, text, timestamptz, text) from authenticated;
grant execute on function public.finalize_manager_world_command(uuid, text, text, jsonb, text, text, text, timestamptz, text) to service_role;

commit;
