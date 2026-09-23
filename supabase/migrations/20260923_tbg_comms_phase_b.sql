-- TBG Comms Phase B: usable direct messages, sanitized projections,
-- social notifications, and mute/block/report foundations.

begin;

create table if not exists public.manager_communication_blocks (
  world_id text not null references public.worlds(id) on delete cascade,
  blocker_manager_id uuid not null references public.manager_profiles(id) on delete cascade,
  blocked_manager_id uuid not null references public.manager_profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (world_id, blocker_manager_id, blocked_manager_id),
  constraint manager_communication_blocks_not_self
    check (blocker_manager_id <> blocked_manager_id)
);

create table if not exists public.conversation_reports (
  id uuid primary key default gen_random_uuid(),
  world_id text not null references public.worlds(id) on delete cascade,
  reporter_manager_id uuid not null references public.manager_profiles(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  message_id uuid not null references public.conversation_messages(id) on delete cascade,
  reason text not null check (reason in ('harassment','spam','abuse','other')),
  details text,
  status text not null default 'open' check (status in ('open','reviewing','closed')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  constraint conversation_reports_details_length
    check (details is null or char_length(details) <= 1000),
  unique (reporter_manager_id, message_id)
);

alter table public.manager_communication_blocks enable row level security;
alter table public.conversation_reports enable row level security;

revoke all on public.manager_communication_blocks from public, anon, authenticated;
revoke all on public.conversation_reports from public, anon, authenticated;
grant select, insert, update, delete on public.manager_communication_blocks to service_role;
grant select, insert, update, delete on public.conversation_reports to service_role;

create index if not exists manager_communication_blocks_blocked_idx
  on public.manager_communication_blocks(world_id, blocked_manager_id, blocker_manager_id);

create index if not exists conversation_reports_status_idx
  on public.conversation_reports(status, created_at asc);

create or replace function private.manager_direct_pair_blocked(
  p_world_id text,
  p_manager_a uuid,
  p_manager_b uuid
) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.manager_communication_blocks block
    where block.world_id = p_world_id
      and (
        (block.blocker_manager_id = p_manager_a and block.blocked_manager_id = p_manager_b)
        or
        (block.blocker_manager_id = p_manager_b and block.blocked_manager_id = p_manager_a)
      )
  )
$$;

revoke all on function private.manager_direct_pair_blocked(text, uuid, uuid)
  from public, anon, authenticated;
grant execute on function private.manager_direct_pair_blocked(text, uuid, uuid)
  to authenticated, service_role;

create or replace function public.get_manager_comms_for_user(
  p_user_id uuid,
  p_world_id text
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_manager_id uuid;
  result_value jsonb;
begin
  select profile.id
    into caller_manager_id
  from public.manager_profiles profile
  join public.manager_appointments appointment
    on appointment.manager_id = profile.id
   and appointment.world_id = p_world_id
   and appointment.status = 'active'
   and appointment.control_type = 'human'
  where profile.user_id = p_user_id
    and profile.status = 'active'
  limit 1;

  if caller_manager_id is null then
    raise exception 'Conversation unavailable';
  end if;

  select jsonb_build_object(
    'manager_id', caller_manager_id,
    'conversations', coalesce(jsonb_agg(row_value order by sort_at desc, conversation_id desc), '[]'::jsonb),
    'unread_count', coalesce(sum(unread_count), 0)
  )
  into result_value
  from (
    select
      conversation.id as conversation_id,
      coalesce(last_message.created_at, conversation.created_at) as sort_at,
      unread.unread_count,
      jsonb_build_object(
        'id', conversation.id,
        'conversation_type', conversation.conversation_type,
        'other_manager_id', other_member.manager_id,
        'other_manager_name', other_profile.display_name,
        'other_club_id', other_appointment.club_id,
        'other_club_name', other_club.name,
        'last_message', case when last_message.id is null then null else jsonb_build_object(
          'message_seq', last_message.message_seq,
          'sender_manager_id', last_message.sender_manager_id,
          'sender_display_name', last_message.sender_display_name,
          'body', left(last_message.body, 180),
          'created_at', last_message.created_at
        ) end,
        'unread_count', unread.unread_count,
        'muted', self_member.muted_at is not null,
        'blocked_by_me', exists (
          select 1
          from public.manager_communication_blocks block
          where block.world_id = p_world_id
            and block.blocker_manager_id = caller_manager_id
            and block.blocked_manager_id = other_member.manager_id
        ),
        'created_at', conversation.created_at
      ) as row_value
    from public.conversations conversation
    join public.conversation_members self_member
      on self_member.conversation_id = conversation.id
     and self_member.manager_id = caller_manager_id
     and self_member.left_at is null
    join lateral (
      select member.manager_id
      from public.conversation_members member
      where member.conversation_id = conversation.id
        and member.manager_id <> caller_manager_id
        and member.left_at is null
      order by member.joined_at asc
      limit 1
    ) other_member on true
    join public.manager_profiles other_profile
      on other_profile.id = other_member.manager_id
    left join public.manager_appointments other_appointment
      on other_appointment.manager_id = other_member.manager_id
     and other_appointment.world_id = conversation.world_id
     and other_appointment.status = 'active'
     and other_appointment.control_type = 'human'
    left join public.clubs other_club
      on other_club.id = other_appointment.club_id
    left join lateral (
      select message.*
      from public.conversation_messages message
      where message.conversation_id = conversation.id
        and message.deleted_at is null
      order by message.message_seq desc
      limit 1
    ) last_message on true
    cross join lateral (
      select count(*)::integer as unread_count
      from public.conversation_messages message
      where message.conversation_id = conversation.id
        and message.message_seq > self_member.last_read_message_seq
        and message.deleted_at is null
        and message.sender_manager_id is distinct from caller_manager_id
    ) unread
    where conversation.world_id = p_world_id
      and conversation.conversation_type = 'direct'
      and conversation.closed_at is null
  ) rows;

  return coalesce(result_value, jsonb_build_object(
    'manager_id', caller_manager_id,
    'conversations', '[]'::jsonb,
    'unread_count', 0
  ));
end;
$$;

create or replace function public.get_manager_conversation_for_user(
  p_user_id uuid,
  p_world_id text,
  p_conversation_id uuid,
  p_limit integer default 100
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_manager_id uuid;
  self_member public.conversation_members;
  conversation_row public.conversations;
  other_manager_id uuid;
  result_value jsonb;
begin
  select profile.id
    into caller_manager_id
  from public.manager_profiles profile
  join public.manager_appointments appointment
    on appointment.manager_id = profile.id
   and appointment.world_id = p_world_id
   and appointment.status = 'active'
   and appointment.control_type = 'human'
  where profile.user_id = p_user_id
    and profile.status = 'active'
  limit 1;

  if caller_manager_id is null then
    raise exception 'Conversation unavailable';
  end if;

  select conversation.*
    into conversation_row
  from public.conversations conversation
  where conversation.id = p_conversation_id
    and conversation.world_id = p_world_id
    and conversation.closed_at is null;

  if conversation_row.id is null then
    raise exception 'Conversation unavailable';
  end if;

  select member.*
    into self_member
  from public.conversation_members member
  where member.conversation_id = p_conversation_id
    and member.manager_id = caller_manager_id
    and member.left_at is null;

  if self_member.conversation_id is null then
    raise exception 'Conversation unavailable';
  end if;

  select member.manager_id
    into other_manager_id
  from public.conversation_members member
  where member.conversation_id = p_conversation_id
    and member.manager_id <> caller_manager_id
    and member.left_at is null
  order by member.joined_at asc
  limit 1;

  select jsonb_build_object(
    'id', conversation_row.id,
    'manager_id', caller_manager_id,
    'last_message_seq', conversation_row.last_message_seq,
    'last_read_message_seq', self_member.last_read_message_seq,
    'muted', self_member.muted_at is not null,
    'blocked_by_me', exists (
      select 1
      from public.manager_communication_blocks block
      where block.world_id = p_world_id
        and block.blocker_manager_id = caller_manager_id
        and block.blocked_manager_id = other_manager_id
    ),
    'participant', (
      select jsonb_build_object(
        'manager_id', profile.id,
        'manager_name', profile.display_name,
        'club_id', appointment.club_id,
        'club_name', club.name
      )
      from public.manager_profiles profile
      left join public.manager_appointments appointment
        on appointment.manager_id = profile.id
       and appointment.world_id = p_world_id
       and appointment.status = 'active'
       and appointment.control_type = 'human'
      left join public.clubs club on club.id = appointment.club_id
      where profile.id = other_manager_id
      limit 1
    ),
    'messages', coalesce((
      select jsonb_agg(to_jsonb(message_row) order by message_row.message_seq asc)
      from (
        select
          message.id,
          message.message_seq,
          message.sender_manager_id,
          message.sender_appointment_id,
          message.sender_club_id,
          message.sender_display_name,
          message.actor_type,
          message.body,
          message.created_at,
          message.edited_at
        from public.conversation_messages message
        where message.conversation_id = p_conversation_id
          and message.deleted_at is null
        order by message.message_seq desc
        limit greatest(1, least(coalesce(p_limit, 100), 200))
      ) message_row
    ), '[]'::jsonb)
  )
  into result_value;

  return result_value;
end;
$$;

create or replace function public.set_conversation_muted(
  p_conversation_id uuid,
  p_muted boolean
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_manager_id uuid;
  conversation_world_id text;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;

  select conversation.world_id
    into conversation_world_id
  from public.conversations conversation
  where conversation.id = p_conversation_id
    and conversation.closed_at is null;

  select profile.id
    into caller_manager_id
  from public.manager_profiles profile
  join public.manager_appointments appointment
    on appointment.manager_id = profile.id
   and appointment.world_id = conversation_world_id
   and appointment.status = 'active'
   and appointment.control_type = 'human'
  where profile.user_id = (select auth.uid())
    and profile.status = 'active'
  limit 1;

  if caller_manager_id is null then
    raise exception 'Conversation unavailable';
  end if;

  update public.conversation_members member
  set muted_at = case when p_muted then coalesce(member.muted_at, now()) else null end
  where member.conversation_id = p_conversation_id
    and member.manager_id = caller_manager_id
    and member.left_at is null;

  if not found then
    raise exception 'Conversation unavailable';
  end if;

  return p_muted;
end;
$$;

create or replace function public.set_manager_communication_block(
  p_world_id text,
  p_other_manager_id uuid,
  p_blocked boolean
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_manager_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;

  select profile.id
    into caller_manager_id
  from public.manager_profiles profile
  join public.manager_appointments appointment
    on appointment.manager_id = profile.id
   and appointment.world_id = p_world_id
   and appointment.status = 'active'
   and appointment.control_type = 'human'
  where profile.user_id = (select auth.uid())
    and profile.status = 'active'
  limit 1;

  if caller_manager_id is null
     or p_other_manager_id is null
     or caller_manager_id = p_other_manager_id
     or not exists (
       select 1
       from public.manager_profiles target_profile
       join public.manager_appointments target_appointment
         on target_appointment.manager_id = target_profile.id
        and target_appointment.world_id = p_world_id
        and target_appointment.status = 'active'
        and target_appointment.control_type = 'human'
       where target_profile.id = p_other_manager_id
         and target_profile.status = 'active'
     ) then
    raise exception 'Conversation unavailable';
  end if;

  if p_blocked then
    insert into public.manager_communication_blocks(
      world_id, blocker_manager_id, blocked_manager_id
    ) values (
      p_world_id, caller_manager_id, p_other_manager_id
    )
    on conflict (world_id, blocker_manager_id, blocked_manager_id) do nothing;
  else
    delete from public.manager_communication_blocks block
    where block.world_id = p_world_id
      and block.blocker_manager_id = caller_manager_id
      and block.blocked_manager_id = p_other_manager_id;
  end if;

  return p_blocked;
end;
$$;

create or replace function public.report_conversation_message(
  p_conversation_id uuid,
  p_message_id uuid,
  p_reason text,
  p_details text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_manager_id uuid;
  conversation_world_id text;
  message_sender_id uuid;
  report_id_value uuid;
  clean_reason text := lower(trim(coalesce(p_reason, '')));
  clean_details text := nullif(trim(coalesce(p_details, '')), '');
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;
  if clean_reason not in ('harassment','spam','abuse','other')
     or char_length(coalesce(clean_details, '')) > 1000 then
    raise exception 'Report unavailable';
  end if;

  select conversation.world_id
    into conversation_world_id
  from public.conversations conversation
  where conversation.id = p_conversation_id
    and conversation.closed_at is null;

  select profile.id
    into caller_manager_id
  from public.manager_profiles profile
  join public.manager_appointments appointment
    on appointment.manager_id = profile.id
   and appointment.world_id = conversation_world_id
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
    raise exception 'Report unavailable';
  end if;

  select message.sender_manager_id
    into message_sender_id
  from public.conversation_messages message
  where message.id = p_message_id
    and message.conversation_id = p_conversation_id
    and message.deleted_at is null;

  if message_sender_id is null or message_sender_id = caller_manager_id then
    raise exception 'Report unavailable';
  end if;

  insert into public.conversation_reports(
    world_id,
    reporter_manager_id,
    conversation_id,
    message_id,
    reason,
    details
  ) values (
    conversation_world_id,
    caller_manager_id,
    p_conversation_id,
    p_message_id,
    clean_reason,
    clean_details
  )
  on conflict (reporter_manager_id, message_id)
  do update set
    reason = excluded.reason,
    details = excluded.details
  returning id into report_id_value;

  return report_id_value;
end;
$$;

-- Respect blocks when opening a direct thread.
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

  select profile.id
    into caller_manager_id
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

  if target_appointment_id is null
     or private.manager_direct_pair_blocked(p_world_id, caller_manager_id, p_other_manager_id) then
    raise exception 'Conversation unavailable';
  end if;

  direct_key_value :=
    least(caller_manager_id::text, p_other_manager_id::text)
    || ':' ||
    greatest(caller_manager_id::text, p_other_manager_id::text);

  insert into public.conversations(
    world_id, conversation_type, direct_key, created_by_manager_id
  ) values (
    p_world_id, 'direct', direct_key_value, caller_manager_id
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

-- Extend Phase A send with block enforcement and social notification fan-out.
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
     )
     or exists (
       select 1
       from public.conversation_members other_member
       where other_member.conversation_id = p_conversation_id
         and other_member.manager_id <> caller_manager_id
         and other_member.left_at is null
         and private.manager_direct_pair_blocked(
           conversation_row.world_id,
           caller_manager_id,
           other_member.manager_id
         )
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
    conversation_id, message_seq, sender_manager_id, sender_appointment_id,
    sender_club_id, sender_display_name, actor_type, actor_id, body, client_request_id
  ) values (
    p_conversation_id, next_seq, caller_manager_id, caller_appointment_id,
    caller_club_id, caller_display_name, 'manager', caller_manager_id::text,
    clean_body, clean_request_key
  )
  returning * into inserted_message;

  update public.conversation_members
  set last_read_message_seq = greatest(last_read_message_seq, next_seq)
  where conversation_id = p_conversation_id
    and manager_id = caller_manager_id;

  insert into public.manager_notifications(
    world_id, manager_id, notification_type, notification_class,
    title, body, action_url, source_type, source_id, dedupe_key, created_at
  )
  select
    conversation_row.world_id,
    recipient.manager_id,
    'direct_message',
    'social',
    caller_display_name || ' sent you a private message',
    'Open your TBG messages to read it.',
    '/?view=comms&conversation=' || p_conversation_id::text,
    'conversation_message',
    inserted_message.id::text,
    'conversation_message:' || inserted_message.id::text,
    inserted_message.created_at
  from public.conversation_members recipient
  join public.manager_profiles recipient_profile
    on recipient_profile.id = recipient.manager_id
   and recipient_profile.status = 'active'
  join public.manager_appointments recipient_appointment
    on recipient_appointment.manager_id = recipient.manager_id
   and recipient_appointment.world_id = conversation_row.world_id
   and recipient_appointment.status = 'active'
   and recipient_appointment.control_type = 'human'
  where recipient.conversation_id = p_conversation_id
    and recipient.manager_id <> caller_manager_id
    and recipient.left_at is null
    and recipient.muted_at is null
  on conflict (manager_id, dedupe_key) do nothing;

  return inserted_message;
end;
$$;

revoke all on function public.get_manager_comms_for_user(uuid, text)
  from public, anon, authenticated;
revoke all on function public.get_manager_conversation_for_user(uuid, text, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.get_manager_comms_for_user(uuid, text) to service_role;
grant execute on function public.get_manager_conversation_for_user(uuid, text, uuid, integer) to service_role;

revoke all on function public.set_conversation_muted(uuid, boolean)
  from public, anon, authenticated;
revoke all on function public.set_manager_communication_block(text, uuid, boolean)
  from public, anon, authenticated;
revoke all on function public.report_conversation_message(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.set_conversation_muted(uuid, boolean) to authenticated;
grant execute on function public.set_manager_communication_block(text, uuid, boolean) to authenticated;
grant execute on function public.report_conversation_message(uuid, uuid, text, text) to authenticated;

comment on table public.manager_communication_blocks is
  'Private manager social blocks. A block suppresses ordinary direct messaging but not authoritative game obligations.';
comment on table public.conversation_reports is
  'Private moderation reports for direct-message content; no automatic gameplay effect.';

commit;
