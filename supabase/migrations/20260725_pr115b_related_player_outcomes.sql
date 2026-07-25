begin;

create or replace function public.finalize_manager_world_command(
  p_command_id uuid,
  p_status text,
  p_reason text,
  p_details jsonb default '{}'::jsonb,
  p_negotiation_state text default null,
  p_subject text default null,
  p_priority text default 'normal',
  p_processed_at timestamptz default now(),
  p_related_player_id text default null
) returns public.manager_world_commands
language plpgsql security definer set search_path = public as $$
declare
  command_row public.manager_world_commands;
  outcome_key text;
begin
  if p_status not in ('applied','rejected','superseded') then
    raise exception 'Invalid terminal command status: %', p_status;
  end if;

  select * into command_row from public.manager_world_commands where id = p_command_id for update;
  if not found then raise exception 'Manager command not found'; end if;

  if command_row.status in ('applied','rejected','superseded') then
    return command_row;
  end if;

  outcome_key := 'command:' || command_row.id::text || ':' || p_status;

  update public.manager_world_commands
  set status = p_status,
      processed_at = p_processed_at,
      terminal_at = p_processed_at,
      outcome_reason = p_reason,
      outcome_details = coalesce(p_details, '{}'::jsonb),
      negotiation_state = coalesce(p_negotiation_state, negotiation_state),
      final_outcome_key = outcome_key
  where id = p_command_id
  returning * into command_row;

  insert into public.manager_command_audit (
    command_id, world_id, manager_id, club_id, outcome_status, outcome_reason, outcome_details, outcome_key, created_at
  ) values (
    command_row.id, command_row.world_id, command_row.manager_id, command_row.club_id,
    p_status, p_reason, coalesce(p_details, '{}'::jsonb), outcome_key, p_processed_at
  ) on conflict (command_id) do nothing;

  insert into public.manager_messages (
    recipient_manager_id, club_id, message_type, subject, body, related_player_id, priority, metadata, created_at
  ) values (
    command_row.manager_id, command_row.club_id, 'world_command_outcome',
    coalesce(p_subject, 'Manager request ' || p_status), p_reason, p_related_player_id, p_priority,
    jsonb_build_object('command_id', command_row.id, 'command_outcome_key', outcome_key), p_processed_at
  ) on conflict do nothing;

  return command_row;
end;
$$;

commit;
