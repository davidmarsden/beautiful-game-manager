-- TBG Comms Phase A: private conversation schema + security boundary.
-- Conversation is social state only. Structured game actions remain authoritative elsewhere.

begin;

create schema if not exists private;
revoke all on schema private from public;

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  world_id text not null references public.worlds(id) on delete cascade,
  conversation_type text not null default 'direct'
    check (conversation_type in ('direct')),
  direct_key text,
  object_type text,
  object_id text,
  created_by_manager_id uuid references public.manager_profiles(id) on delete set null,
  last_message_seq bigint not null default 0 check (last_message_seq >= 0),
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  constraint conversations_direct_key_required check (
    conversation_type <> 'direct' or direct_key is not null
  ),
  constraint conversations_object_binding_pair check (
    (object_type is null and object_id is null)
    or (object_type is not null and object_id is not null)
  )
);

create unique index if not exists conversations_direct_pair_uidx
  on public.conversations(world_id, direct_key)
  where conversation_type = 'direct';

create index if not exists conversations_world_created_idx
  on public.conversations(world_id, created_at desc, id desc);

create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  manager_id uuid not null references public.manager_profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  last_read_message_seq bigint not null default 0 check (last_read_message_seq >= 0),
  muted_at timestamptz,
  left_at timestamptz,
  primary key (conversation_id, manager_id)
);

create index if not exists conversation_members_manager_idx
  on public.conversation_members(manager_id, conversation_id);

create table if not exists public.conversation_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  message_seq bigint not null check (message_seq > 0),
  sender_manager_id uuid references public.manager_profiles(id) on delete set null,
  sender_appointment_id uuid references public.manager_appointments(id) on delete set null,
  sender_club_id text references public.clubs(id) on delete set null,
  sender_display_name text not null,
  actor_type text not null default 'manager' check (actor_type in ('manager')),
  actor_id text,
  body text not null,
  client_request_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  constraint conversation_messages_body_length
    check (char_length(trim(body)) between 1 and 4000),
  constraint conversation_messages_request_key_length
    check (client_request_id is null or char_length(client_request_id) between 1 and 120),
  unique (conversation_id, message_seq)
);

create unique index if not exists conversation_messages_request_uidx
  on public.conversation_messages(conversation_id, sender_manager_id, client_request_id)
  where client_request_id is not null and sender_manager_id is not null;

create index if not exists conversation_messages_conversation_seq_idx
  on public.conversation_messages(conversation_id, message_seq desc);

alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.conversation_messages enable row level security;

revoke all on public.conversations from public, anon, authenticated;
revoke all on public.conversation_members from public, anon, authenticated;
revoke all on public.conversation_messages from public, anon, authenticated;

grant select on public.conversations to authenticated;
grant select on public.conversation_members to authenticated;
grant select on public.conversation_messages to authenticated;

grant select, insert, update, delete on public.conversations to service_role;
grant select, insert, update, delete on public.conversation_members to service_role;
grant select, insert, update, delete on public.conversation_messages to service_role;

-- RLS helper lives outside the exposed public schema. It derives identity only
-- from auth.uid() and returns no conversation data.
create or replace function private.manager_can_read_conversation(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.conversation_members member
    join public.manager_profiles profile
      on profile.id = member.manager_id
    where member.conversation_id = p_conversation_id
      and member.left_at is null
      and profile.user_id = (select auth.uid())
      and profile.status = 'active'
  )
$$;

revoke all on function private.manager_can_read_conversation(uuid)
  from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.manager_can_read_conversation(uuid)
  to authenticated;

drop policy if exists "conversation members can read conversations"
  on public.conversations;
create policy "conversation members can read conversations"
  on public.conversations
  for select
  to authenticated
  using ((select private.manager_can_read_conversation(id)));

drop policy if exists "conversation members can read membership"
  on public.conversation_members;
create policy "conversation members can read membership"
  on public.conversation_members
  for select
  to authenticated
  using ((select private.manager_can_read_conversation(conversation_id)));

drop policy if exists "conversation members can read messages"
  on public.conversation_messages;
create policy "conversation members can read messages"
  on public.conversation_messages
  for select
  to authenticated
  using ((select private.manager_can_read_conversation(conversation_id)));

-- Start or recover the one direct thread for two managers in one world.
-- Club/appointment eligibility is current-state policy; membership itself is
-- manager-to-manager and therefore survives later club changes.
create or replace function public.start_direct_conversation(
  p_world_id text,
  p_other_manager_id uuid
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_manager_id uuid;
  caller_appointment_id uuid;
  target_appointment_id uuid;
  conversation_id_value uuid;
  direct_key_value text;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;
  if trim(coalesce(p_world_id, '')) = '' or p_other_manager_id is null then
    raise exception 'Conversation unavailable';
  end if;

  select profile.id, appointment.id
    into caller_manager_id, caller_appointment_id
  from public.manager_profiles profile
  join public.manager_appointments appointment
    on appointment.manager_id = profile.id
   and appointment.world_id = p_world_id
   and appointment.status = 'active'
   and appointment.control_type = 'human'
  where profile.user_id = (select auth.uid())
    and profile.status = 'active'
  limit 1;

  if caller_manager_id is null or caller_manager_id = p_other_manager_id then
    raise exception 'Conversation unavailable';
  end if;

  select appointment.id
    into target_appointment_id
  from public.manager_profiles profile
  join public.manager_appointments appointment
    on appointment.manager_id = profile.id
   and appointment.world_id = p_world_id
   and appointment.status = 'active'
   and appointment.control_type = 'human'
  where profile.id = p_other_manager_id
    and profile.status = 'active'
  limit 1;

  if target_appointment_id is null then
    raise exception 'Conversation unavailable';
  end if;

  direct_key_value :=
    least(caller_manager_id::text, p_other_manager_id::text)
    || ':' ||
    greatest(caller_manager_id::text, p_other_manager_id::text);

  insert into public.conversations(
    world_id,
    conversation_type,
    direct_key,
    created_by_manager_id
  ) values (
    p_world_id,
    'direct',
    direct_key_value,
    caller_manager_id
  )
  on conflict (world_id, direct_key)
    where conversation_type = 'direct'
  do nothing
  returning id into conversation_id_value;

  if conversation_id_value is null then
    select conversation.id
      into conversation_id_value
    from public.conversations conversation
    where conversation.world_id = p_world_id
      and conversation.conversation_type = 'direct'
      and conversation.direct_key = direct_key_value
    limit 1;
  end if;

  if conversation_id_value is null then
    raise exception 'Conversation unavailable';
  end if;

  insert into public.conversation_members(conversation_id, manager_id)
  values
    (conversation_id_value, caller_manager_id),
    (conversation_id_value, p_other_manager_id)
  on conflict (conversation_id, manager_id) do nothing;

  return conversation_id_value;
end;
$$;

-- Message ordering is allocated while holding the conversation row lock.
-- mark_conversation_read locks the same row, so sends and read-cursor
-- advancement have one serialization point and cannot race past each other.
create or replace function public.send_conversation_message(
  p_conversation_id uuid,
  p_body text,
  p_request_key text
) returns public.conversation_messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  conversation_row public.conversations;
  caller_manager_id uuid;
  caller_appointment_id uuid;
  caller_club_id text;
  caller_display_name text;
  existing_message public.conversation_messages;
  inserted_message public.conversation_messages;
  next_seq bigint;
  clean_body text := trim(coalesce(p_body, ''));
  clean_request_key text := trim(coalesce(p_request_key, ''));
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;
  if p_conversation_id is null
     or char_length(clean_body) not between 1 and 4000
     or char_length(clean_request_key) not between 1 and 120 then
    raise exception 'Message unavailable';
  end if;

  select *
    into conversation_row
  from public.conversations
  where id = p_conversation_id
  for update;

  if not found or conversation_row.closed_at is not null then
    raise exception 'Conversation unavailable';
  end if;

  select profile.id, appointment.id, appointment.club_id, profile.display_name
    into caller_manager_id, caller_appointment_id, caller_club_id, caller_display_name
  from public.manager_profiles profile
  join public.manager_appointments appointment
    on appointment.manager_id = profile.id
   and appointment.world_id = conversation_row.world_id
   and appointment.status = 'active'
   and appointment.control_type = 'human'
  where profile.user_id = (select auth.uid())
    and profile.status = 'active'
  limit 1;

  if caller_manager_id is null
     or not exists (
       select 1
       from public.conversation_members member
       where member.conversation_id = p_conversation_id
         and member.manager_id = caller_manager_id
         and member.left_at is null
     ) then
    raise exception 'Conversation unavailable';
  end if;

  select *
    into existing_message
  from public.conversation_messages message
  where message.conversation_id = p_conversation_id
    and message.sender_manager_id = caller_manager_id
    and message.client_request_id = clean_request_key
  limit 1;

  if found then
    return existing_message;
  end if;

  update public.conversations
  set last_message_seq = last_message_seq + 1
  where id = p_conversation_id
  returning last_message_seq into next_seq;

  insert into public.conversation_messages(
    conversation_id,
    message_seq,
    sender_manager_id,
    sender_appointment_id,
    sender_club_id,
    sender_display_name,
    actor_type,
    actor_id,
    body,
    client_request_id
  ) values (
    p_conversation_id,
    next_seq,
    caller_manager_id,
    caller_appointment_id,
    caller_club_id,
    caller_display_name,
    'manager',
    caller_manager_id::text,
    clean_body,
    clean_request_key
  )
  returning * into inserted_message;

  -- A manager has necessarily read the message they just sent. Advance only
  -- their own cursor; other participants retain their existing unread state.
  update public.conversation_members
  set last_read_message_seq = greatest(last_read_message_seq, next_seq)
  where conversation_id = p_conversation_id
    and manager_id = caller_manager_id;

  return inserted_message;
end;
$$;

create or replace function public.mark_conversation_read(
  p_conversation_id uuid,
  p_message_seq bigint
) returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  conversation_row public.conversations;
  caller_manager_id uuid;
  updated_cursor bigint;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;
  if p_conversation_id is null or p_message_seq is null or p_message_seq < 0 then
    raise exception 'Conversation unavailable';
  end if;

  select *
    into conversation_row
  from public.conversations
  where id = p_conversation_id
  for update;

  if not found then
    raise exception 'Conversation unavailable';
  end if;

  select profile.id
    into caller_manager_id
  from public.manager_profiles profile
  where profile.user_id = (select auth.uid())
    and profile.status = 'active'
  limit 1;

  if caller_manager_id is null
     or not exists (
       select 1
       from public.conversation_members member
       where member.conversation_id = p_conversation_id
         and member.manager_id = caller_manager_id
         and member.left_at is null
     ) then
    raise exception 'Conversation unavailable';
  end if;

  if p_message_seq > conversation_row.last_message_seq then
    raise exception 'Conversation unavailable';
  end if;

  if p_message_seq > 0 and not exists (
    select 1
    from public.conversation_messages message
    where message.conversation_id = p_conversation_id
      and message.message_seq = p_message_seq
  ) then
    raise exception 'Conversation unavailable';
  end if;

  update public.conversation_members
  set last_read_message_seq = greatest(last_read_message_seq, p_message_seq)
  where conversation_id = p_conversation_id
    and manager_id = caller_manager_id
  returning last_read_message_seq into updated_cursor;

  if updated_cursor is null then
    raise exception 'Conversation unavailable';
  end if;

  return updated_cursor;
end;
$$;

revoke all on function public.start_direct_conversation(text, uuid)
  from public, anon, authenticated;
revoke all on function public.send_conversation_message(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.mark_conversation_read(uuid, bigint)
  from public, anon, authenticated;

grant execute on function public.start_direct_conversation(text, uuid)
  to authenticated;
grant execute on function public.send_conversation_message(uuid, text, text)
  to authenticated;
grant execute on function public.mark_conversation_read(uuid, bigint)
  to authenticated;

comment on table public.conversations is
  'TBG Comms conversation containers. Social state only; never authoritative football actions.';
comment on table public.conversation_members is
  'Server-controlled conversation membership and per-member monotonic read cursor.';
comment on table public.conversation_messages is
  'Private conversational messages with send-time manager/appointment/club snapshots.';
comment on column public.conversation_messages.message_seq is
  'Monotonic sequence allocated under the parent conversation row lock; authoritative for unread ordering.';
comment on column public.conversation_messages.client_request_id is
  'Caller-generated idempotency key. Repeated sends with the same manager/conversation/key return the original message.';

commit;
