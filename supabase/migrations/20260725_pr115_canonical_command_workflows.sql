-- PR #115: canonical, auditable and idempotent manager command workflows.

begin;

alter table public.manager_world_commands
  add column if not exists request_key text,
  add column if not exists negotiation_state text,
  add column if not exists final_outcome_key text,
  add column if not exists terminal_at timestamptz;

update public.manager_world_commands
set request_key = encode(digest(
  concat_ws('|', world_id::text, manager_id::text, club_id::text, command_type,
    coalesce(command_payload->>'playerId', command_payload->>'player_id', ''),
    coalesce(command_payload->>'otherClubId', command_payload->>'other_club_id', ''),
    coalesce(command_payload->>'client_request_id', id::text)
  ), 'sha256'), 'hex')
where request_key is null;

alter table public.manager_world_commands
  alter column request_key set not null;

create unique index if not exists manager_world_commands_request_key_uidx
  on public.manager_world_commands(world_id, manager_id, request_key);

create unique index if not exists manager_world_commands_final_outcome_uidx
  on public.manager_world_commands(final_outcome_key)
  where final_outcome_key is not null;

create unique index if not exists manager_messages_command_outcome_uidx
  on public.manager_messages((metadata->>'command_outcome_key'))
  where metadata ? 'command_outcome_key';

create table if not exists public.manager_command_audit (
  id uuid primary key default gen_random_uuid(),
  command_id uuid not null references public.manager_world_commands(id) on delete cascade,
  world_id text not null,
  manager_id uuid not null references public.manager_profiles(id) on delete cascade,
  club_id text not null,
  outcome_status text not null check (outcome_status in ('applied','rejected','superseded')),
  outcome_reason text not null,
  outcome_details jsonb not null default '{}'::jsonb,
  outcome_key text not null unique,
  created_at timestamptz not null default now(),
  unique(command_id)
);

alter table public.manager_command_audit enable row level security;

drop policy if exists "managers can read own command audit" on public.manager_command_audit;
create policy "managers can read own command audit"
  on public.manager_command_audit for select to authenticated
  using (manager_id = public.current_manager_id());

create or replace function public.manager_command_subject_key(
  p_command_type text,
  p_payload jsonb
) returns text language sql immutable as $$
  select case
    when p_command_type in ('register_player','unregister_player') then
      'registration:' || coalesce(p_payload->>'playerId', p_payload->>'player_id', '')
    when p_command_type = 'renew_contract' then
      'contract:' || coalesce(p_payload->>'playerId', p_payload->>'player_id', '')
    when p_command_type in ('transfer_offer','transfer_listing','transfer_response') then
      'transfer:' || coalesce(p_payload->>'playerId', p_payload->>'player_id', '') || ':' ||
      coalesce(p_payload->>'otherClubId', p_payload->>'other_club_id', '')
    else p_command_type
  end;
$$;

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
language plpgsql security definer set search_path = public as $$
declare
  existing public.manager_world_commands;
  inserted public.manager_world_commands;
  subject_key text;
  submitted_at_value timestamptz := now();
begin
  if p_manager_id <> public.current_manager_id() then
    raise exception 'Manager identity does not match the authenticated session';
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

create or replace function public.finalize_manager_world_command(
  p_command_id uuid,
  p_status text,
  p_reason text,
  p_details jsonb default '{}'::jsonb,
  p_negotiation_state text default null,
  p_subject text default null,
  p_priority text default 'normal',
  p_processed_at timestamptz default now()
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
    recipient_manager_id, club_id, message_type, subject, body, priority, metadata, created_at
  ) values (
    command_row.manager_id, command_row.club_id, 'world_command_outcome',
    coalesce(p_subject, 'Manager request ' || p_status), p_reason, p_priority,
    jsonb_build_object('command_id', command_row.id, 'command_outcome_key', outcome_key), p_processed_at
  ) on conflict do nothing;

  return command_row;
end;
$$;

comment on column public.manager_world_commands.request_key is
  'Client-stable idempotency key. Reprocessing the same command returns the original ledger row.';
comment on column public.manager_world_commands.negotiation_state is
  'Explicit transfer negotiation state, for example offer_submitted, awaiting_response, accepted or declined.';
comment on table public.manager_command_audit is
  'Exactly one immutable audit record for each final manager-command outcome.';

commit;
