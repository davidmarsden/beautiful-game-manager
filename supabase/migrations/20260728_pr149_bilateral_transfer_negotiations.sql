-- PR #149: secure manager-facing bilateral transfer negotiations.

begin;

alter table public.manager_world_commands
  add column if not exists referenced_command_id uuid references public.manager_world_commands(id) on delete set null;

create unique index if not exists manager_world_commands_transfer_response_uidx
  on public.manager_world_commands(referenced_command_id)
  where command_type = 'transfer_response' and referenced_command_id is not null;

create or replace function public.get_manager_transfer_inbox(p_world_id text)
returns setof public.manager_world_commands
language plpgsql
security definer
set search_path = public
as $$
declare
  manager_id_value uuid := public.current_manager_id();
  club_id_value text;
begin
  select appointment.club_id into club_id_value
  from public.manager_appointments appointment
  where appointment.manager_id = manager_id_value
    and appointment.world_id = p_world_id
    and appointment.status = 'active'
  limit 1;

  if club_id_value is null then
    raise exception 'No active club appointment for this world';
  end if;

  return query
  select offer.*
  from public.manager_world_commands offer
  where offer.world_id = p_world_id
    and offer.command_type = 'transfer_offer'
    and offer.status = 'pending'
    and coalesce(offer.command_payload->>'otherClubId', offer.command_payload->>'other_club_id') = club_id_value
    and not exists (
      select 1 from public.manager_world_commands response
      where response.referenced_command_id = offer.id
        and response.command_type = 'transfer_response'
    )
  order by offer.submitted_at asc, offer.id asc;
end;
$$;

create or replace function public.submit_manager_transfer_response(
  p_world_id text,
  p_proposal_id uuid,
  p_response text,
  p_request_key text
) returns public.manager_world_commands
language plpgsql
security definer
set search_path = public
as $$
declare
  manager_id_value uuid := public.current_manager_id();
  appointment_row public.manager_appointments;
  proposal public.manager_world_commands;
  existing public.manager_world_commands;
  inserted public.manager_world_commands;
  response_value text := lower(trim(coalesce(p_response, '')));
  player_id_value text;
  buyer_club_id text;
  payload jsonb;
begin
  if response_value not in ('accepted', 'declined') then
    raise exception 'Transfer response must be accepted or declined';
  end if;

  select * into appointment_row
  from public.manager_appointments appointment
  where appointment.manager_id = manager_id_value
    and appointment.world_id = p_world_id
    and appointment.status = 'active'
  limit 1;

  if not found then raise exception 'No active club appointment for this world'; end if;

  select * into proposal
  from public.manager_world_commands offer
  where offer.id = p_proposal_id
    and offer.world_id = p_world_id
    and offer.command_type = 'transfer_offer'
    and offer.status = 'pending'
  for update;

  if not found then raise exception 'Transfer offer is no longer available'; end if;
  if coalesce(proposal.command_payload->>'otherClubId', proposal.command_payload->>'other_club_id') <> appointment_row.club_id then
    raise exception 'Transfer offer is not addressed to the appointed club';
  end if;

  select * into existing
  from public.manager_world_commands response
  where response.world_id = p_world_id
    and response.manager_id = manager_id_value
    and response.request_key = p_request_key;
  if found then return existing; end if;

  if exists (
    select 1 from public.manager_world_commands response
    where response.referenced_command_id = proposal.id
      and response.command_type = 'transfer_response'
  ) then
    raise exception 'This transfer offer has already received a response';
  end if;

  player_id_value := coalesce(proposal.command_payload->>'playerId', proposal.command_payload->>'player_id');
  buyer_club_id := proposal.club_id;
  payload := jsonb_build_object(
    'proposalId', proposal.id,
    'playerId', player_id_value,
    'otherClubId', buyer_club_id,
    'direction', 'sell',
    'fee', coalesce((proposal.command_payload->>'fee')::numeric, 0),
    'contractYears', coalesce((proposal.command_payload->>'contractYears')::integer, (proposal.command_payload->>'contract_years')::integer, 3),
    'response', response_value,
    'client_request_id', p_request_key
  );

  insert into public.manager_world_commands (
    world_id, manager_id, club_id, command_type, command_payload, status,
    effective_season_id, effective_matchday, submitted_at, request_key,
    negotiation_state, referenced_command_id
  ) values (
    p_world_id, manager_id_value, appointment_row.club_id, 'transfer_response', payload, 'pending',
    proposal.effective_season_id, proposal.effective_matchday, now(), p_request_key,
    case when response_value = 'accepted' then 'accepted_pending_checkpoint' else 'declined_pending_checkpoint' end,
    proposal.id
  ) returning * into inserted;

  update public.manager_world_commands
  set negotiation_state = case when response_value = 'accepted' then 'accepted_pending_checkpoint' else 'declined_pending_checkpoint' end,
      outcome_details = coalesce(outcome_details, '{}'::jsonb) || jsonb_build_object(
        'response_command_id', inserted.id,
        'responding_club_id', appointment_row.club_id,
        'response', response_value
      )
  where id = proposal.id;

  return inserted;
end;
$$;

create or replace function public.propagate_transfer_response_outcome()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  proposal public.manager_world_commands;
  proposal_status text;
  proposal_state text;
  proposal_reason text;
  proposal_key text;
  player_name_value text;
begin
  if new.command_type <> 'transfer_response'
     or new.referenced_command_id is null
     or new.status not in ('applied', 'rejected')
     or old.status = new.status then
    return new;
  end if;

  select * into proposal
  from public.manager_world_commands
  where id = new.referenced_command_id
  for update;
  if not found or proposal.status <> 'pending' then return new; end if;

  player_name_value := coalesce(new.outcome_details->>'player_name', new.command_payload->>'playerId', 'Player');
  if new.status = 'applied' then
    proposal_status := 'applied';
    proposal_state := 'accepted_applied';
    proposal_reason := 'The receiving club accepted the transfer offer and the transfer was applied to the canonical world.';
  elsif new.negotiation_state = 'declined' then
    proposal_status := 'rejected';
    proposal_state := 'declined';
    proposal_reason := 'The receiving club declined the transfer offer.';
  else
    proposal_status := 'rejected';
    proposal_state := 'accepted_application_failed';
    proposal_reason := 'The receiving club accepted the offer, but the transfer could not be applied: ' || coalesce(new.outcome_reason, 'canonical validation failed');
  end if;

  proposal_key := 'command:' || proposal.id::text || ':' || proposal_status;
  update public.manager_world_commands
  set status = proposal_status,
      negotiation_state = proposal_state,
      processed_at = new.processed_at,
      terminal_at = new.terminal_at,
      outcome_reason = proposal_reason,
      outcome_details = coalesce(outcome_details, '{}'::jsonb) || jsonb_build_object(
        'response_command_id', new.id,
        'response_status', new.status,
        'response_negotiation_state', new.negotiation_state
      ),
      final_outcome_key = proposal_key
  where id = proposal.id;

  insert into public.manager_command_audit (
    command_id, world_id, manager_id, club_id, outcome_status, outcome_reason, outcome_details, outcome_key, created_at
  ) values (
    proposal.id, proposal.world_id, proposal.manager_id, proposal.club_id,
    proposal_status, proposal_reason,
    jsonb_build_object('response_command_id', new.id, 'negotiation_state', proposal_state),
    proposal_key, coalesce(new.terminal_at, now())
  ) on conflict (command_id) do nothing;

  insert into public.manager_messages (
    recipient_manager_id, club_id, message_type, subject, body, priority, metadata, created_at
  ) values (
    proposal.manager_id, proposal.club_id, 'world_command_outcome',
    player_name_value || ': transfer offer ' || case when proposal_status = 'applied' then 'completed' else 'closed' end,
    proposal_reason, case when proposal_status = 'applied' then 'normal' else 'high' end,
    jsonb_build_object('command_id', proposal.id, 'command_outcome_key', proposal_key, 'response_command_id', new.id),
    coalesce(new.terminal_at, now())
  ) on conflict do nothing;

  return new;
end;
$$;

drop trigger if exists propagate_transfer_response_outcome on public.manager_world_commands;
create trigger propagate_transfer_response_outcome
after update of status on public.manager_world_commands
for each row execute function public.propagate_transfer_response_outcome();

revoke all on function public.get_manager_transfer_inbox(text) from public, anon;
grant execute on function public.get_manager_transfer_inbox(text) to authenticated;
revoke all on function public.submit_manager_transfer_response(text, uuid, text, text) from public, anon;
grant execute on function public.submit_manager_transfer_response(text, uuid, text, text) to authenticated;

comment on column public.manager_world_commands.referenced_command_id is
  'Links a transfer response to the authoritative original offer.';

commit;
