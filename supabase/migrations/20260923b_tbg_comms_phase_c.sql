-- TBG Comms Phase C: canonical object-bound public discussion.
-- Reuses World Feed comments without turning object discussion anchors into News items.

begin;

alter table public.world_feed_items
  add column if not exists object_type text,
  add column if not exists object_id text,
  add column if not exists object_title text;

alter table public.world_feed_items
  drop constraint if exists world_feed_items_item_type_check;
alter table public.world_feed_items
  add constraint world_feed_items_item_type_check
  check (item_type = any (array[
    'manager_post'::text,
    'manager_appointment'::text,
    'transfer_completed'::text,
    'matchday_upcoming'::text,
    'matchday_completed'::text,
    'matchday_press_conference'::text,
    'alpha_update'::text,
    'object_discussion'::text
  ]));

alter table public.world_feed_items
  drop constraint if exists world_feed_items_object_binding_check;
alter table public.world_feed_items
  add constraint world_feed_items_object_binding_check check (
    (item_type = 'object_discussion'
      and object_type in ('player','club','fixture','news')
      and nullif(trim(object_id), '') is not null
      and nullif(trim(object_title), '') is not null)
    or
    (item_type <> 'object_discussion'
      and object_type is null
      and object_id is null
      and object_title is null)
  );

create unique index if not exists world_feed_object_discussion_uidx
  on public.world_feed_items(world_id, object_type, object_id)
  where item_type = 'object_discussion' and hidden_at is null;

create index if not exists world_feed_object_discussion_lookup_idx
  on public.world_feed_items(world_id, object_type, object_id, created_at desc)
  where item_type = 'object_discussion';

create or replace function public.ensure_object_discussion_for_user(
  p_user_id uuid,
  p_world_id text,
  p_object_type text,
  p_object_id text,
  p_object_title text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $phase_c$
declare
  manager_id_value uuid;
  normalized_type text := lower(trim(coalesce(p_object_type, '')));
  normalized_id text := trim(coalesce(p_object_id, ''));
  normalized_title text := left(trim(coalesce(p_object_title, '')), 240);
  discussion_id uuid;
  object_exists boolean := false;
begin
  select profile.id into manager_id_value
  from public.manager_profiles profile
  join public.manager_appointments appointment
    on appointment.manager_id = profile.id
   and appointment.world_id = p_world_id
   and appointment.status = 'active'
   and appointment.control_type = 'human'
  where profile.user_id = p_user_id
    and profile.status = 'active'
  limit 1;

  if manager_id_value is null then
    raise exception 'Object discussion unavailable';
  end if;

  if normalized_type not in ('player','club','fixture','news')
     or normalized_id = ''
     or normalized_title = '' then
    raise exception 'Object discussion unavailable';
  end if;

  if normalized_type = 'club' then
    select exists (
      select 1 from public.clubs club
      where club.world_id = p_world_id and club.id = normalized_id
    ) into object_exists;
  elsif normalized_type = 'fixture' then
    select exists (
      select 1 from public.fixtures fixture
      where fixture.world_id = p_world_id and fixture.id = normalized_id
    ) into object_exists;
  elsif normalized_type = 'news' then
    select exists (
      select 1 from public.world_feed_items item
      where item.world_id = p_world_id
        and item.id::text = normalized_id
        and item.hidden_at is null
        and item.item_type <> 'object_discussion'
    ) into object_exists;
  elsif normalized_type = 'player' then
    select exists (
      select 1
      from public.canonical_world_saves save
      where save.world_id = p_world_id
        and coalesce(save.save_envelope->'world'->'squad_cycle'->'players', '{}'::jsonb) ? normalized_id
    ) into object_exists;
  end if;

  if not object_exists then
    raise exception 'Object discussion unavailable';
  end if;

  select item.id into discussion_id
  from public.world_feed_items item
  where item.world_id = p_world_id
    and item.item_type = 'object_discussion'
    and item.object_type = normalized_type
    and item.object_id = normalized_id
    and item.hidden_at is null
  limit 1;

  if discussion_id is not null then
    return discussion_id;
  end if;

  insert into public.world_feed_items(
    world_id,
    item_type,
    actor_manager_id,
    title,
    body,
    source_key,
    object_type,
    object_id,
    object_title,
    metadata
  ) values (
    p_world_id,
    'object_discussion',
    manager_id_value,
    'Discussion · ' || normalized_title,
    'Public manager discussion attached to this TBG ' || normalized_type || '.',
    'object-discussion:' || normalized_type || ':' || normalized_id,
    normalized_type,
    normalized_id,
    normalized_title,
    jsonb_build_object(
      'authority', 'discussion_only',
      'object_type', normalized_type,
      'object_id', normalized_id
    )
  )
  on conflict (world_id, object_type, object_id)
    where item_type = 'object_discussion' and hidden_at is null
  do update set object_title = excluded.object_title
  returning id into discussion_id;

  return discussion_id;
end;
$phase_c$;

create or replace function public.get_object_discussion_for_user(
  p_user_id uuid,
  p_world_id text,
  p_object_type text,
  p_object_id text,
  p_object_title text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $phase_c$
declare
  discussion_id uuid;
  result_value jsonb;
begin
  discussion_id := public.ensure_object_discussion_for_user(
    p_user_id, p_world_id, p_object_type, p_object_id, p_object_title
  );

  select jsonb_build_object(
    'id', item.id,
    'object_type', item.object_type,
    'object_id', item.object_id,
    'object_title', item.object_title,
    'authority', 'discussion_only',
    'comments', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', comment.id,
          'parent_comment_id', comment.parent_comment_id,
          'manager_id', comment.manager_id,
          'manager_name', profile.display_name,
          'club_id', comment.club_id,
          'club_name', coalesce(club.name, comment.club_id),
          'body', comment.body,
          'created_at', comment.created_at,
          'edited_at', comment.edited_at
        ) order by comment.created_at asc, comment.id asc
      )
      from public.world_feed_comments comment
      join public.manager_profiles profile on profile.id = comment.manager_id
      left join public.clubs club
        on club.id = comment.club_id
       and club.world_id = p_world_id
      where comment.feed_item_id = item.id
        and comment.hidden_at is null
    ), '[]'::jsonb)
  )
  into result_value
  from public.world_feed_items item
  where item.id = discussion_id
    and item.hidden_at is null;

  return result_value;
end;
$phase_c$;

create or replace function public.create_object_discussion_comment_for_user(
  p_user_id uuid,
  p_world_id text,
  p_object_type text,
  p_object_id text,
  p_object_title text,
  p_body text,
  p_parent_comment_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $phase_c$
declare
  discussion_id uuid;
  manager_id_value uuid;
  manager_display_name text;
  club_id_value text;
  normalized_body text := trim(coalesce(p_body, ''));
  comment_row public.world_feed_comments;
  parent_row public.world_feed_comments;
  normalized_type text := lower(trim(coalesce(p_object_type, '')));
  normalized_id text := trim(coalesce(p_object_id, ''));
begin
  if normalized_body = '' or char_length(normalized_body) > 2000 then
    raise exception 'Comment must be between 1 and 2000 characters';
  end if;

  discussion_id := public.ensure_object_discussion_for_user(
    p_user_id, p_world_id, normalized_type, normalized_id, p_object_title
  );

  select profile.id, profile.display_name, appointment.club_id
    into manager_id_value, manager_display_name, club_id_value
  from public.manager_profiles profile
  join public.manager_appointments appointment
    on appointment.manager_id = profile.id
   and appointment.world_id = p_world_id
   and appointment.status = 'active'
   and appointment.control_type = 'human'
  where profile.user_id = p_user_id
    and profile.status = 'active'
  limit 1;

  if manager_id_value is null then
    raise exception 'Object discussion unavailable';
  end if;

  if p_parent_comment_id is not null then
    select comment.* into parent_row
    from public.world_feed_comments comment
    where comment.id = p_parent_comment_id
      and comment.feed_item_id = discussion_id
      and comment.hidden_at is null
    limit 1;
    if parent_row.id is null then
      raise exception 'Reply target is unavailable';
    end if;
  end if;

  insert into public.world_feed_comments(
    feed_item_id, manager_id, club_id, body, parent_comment_id
  ) values (
    discussion_id, manager_id_value, club_id_value, normalized_body, p_parent_comment_id
  )
  returning * into comment_row;

  if parent_row.id is not null and parent_row.manager_id <> manager_id_value then
    insert into public.manager_notifications(
      world_id, manager_id, notification_type, notification_class,
      title, body, action_url, source_type, source_id, dedupe_key, created_at
    ) values (
      p_world_id,
      parent_row.manager_id,
      'object_discussion_reply',
      'info',
      'New reply in ' || left(trim(coalesce(p_object_title, 'discussion')), 120),
      manager_display_name || ' replied to your comment.',
      '/?discussion_type=' || normalized_type || '&discussion_id=' || normalized_id,
      'object_discussion_comment',
      comment_row.id::text,
      'object_discussion_comment:' || comment_row.id::text || ':reply',
      comment_row.created_at
    ) on conflict(manager_id, dedupe_key) do nothing;
  end if;

  return jsonb_build_object(
    'id', comment_row.id,
    'discussion_id', discussion_id,
    'parent_comment_id', comment_row.parent_comment_id,
    'created_at', comment_row.created_at
  );
end;
$phase_c$;

-- Object-discussion anchors are canonical discussion infrastructure, not News.
create or replace function public.get_manager_world_feed_for_user(
  p_user_id uuid,
  p_world_id text,
  p_limit integer default 50
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $phase_c$
declare
  manager_id_value uuid;
  club_id_value text;
  can_moderate_value boolean := false;
  result_value jsonb;
begin
  select profile.id, appointment.club_id, coalesce(profile.is_admin, false)
    into manager_id_value, club_id_value, can_moderate_value
  from public.manager_profiles profile
  join public.manager_appointments appointment
    on appointment.manager_id = profile.id
   and appointment.world_id = p_world_id
   and appointment.status = 'active'
  where profile.user_id = p_user_id
  limit 1;

  if manager_id_value is null then
    raise exception 'No active manager appointment for this user and world';
  end if;

  with comment_activity as (
    select comment.feed_item_id, max(comment.created_at) as latest_comment_at
    from public.world_feed_comments comment
    join public.world_feed_items comment_item
      on comment_item.id = comment.feed_item_id
     and comment_item.world_id = p_world_id
     and comment_item.item_type <> 'object_discussion'
    where comment.hidden_at is null
    group by comment.feed_item_id
  ),
  limited_items as (
    select item.*, greatest(item.created_at, coalesce(comment_activity.latest_comment_at, item.created_at)) as activity_at
    from public.world_feed_items item
    left join comment_activity on comment_activity.feed_item_id = item.id
    where item.world_id = p_world_id
      and item.hidden_at is null
      and item.item_type <> 'object_discussion'
    order by
      (item.pinned_at is not null) desc,
      item.pinned_at desc nulls last,
      greatest(item.created_at, coalesce(comment_activity.latest_comment_at, item.created_at)) desc,
      item.created_at desc,
      item.id desc
    limit greatest(1, least(coalesce(p_limit, 50), 100))
  ),
  comment_rows as (
    select
      comment.feed_item_id,
      jsonb_agg(
        jsonb_build_object(
          'id', comment.id,
          'parent_comment_id', comment.parent_comment_id,
          'manager_id', comment.manager_id,
          'manager_name', commenter.display_name,
          'club_id', comment.club_id,
          'club_name', coalesce(comment_club.name, comment.club_id),
          'body', comment.body,
          'created_at', comment.created_at,
          'edited_at', comment.edited_at
        ) order by comment.created_at asc, comment.id asc
      ) as comments
    from limited_items limited_item
    join public.world_feed_comments comment
      on comment.feed_item_id = limited_item.id
     and comment.hidden_at is null
    join public.manager_profiles commenter on commenter.id = comment.manager_id
    left join public.clubs comment_club
      on comment_club.id = comment.club_id
     and comment_club.world_id = p_world_id
    group by comment.feed_item_id
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', item.id,
        'item_type', item.item_type,
        'title', item.title,
        'body', item.body,
        'actor_manager_id', item.actor_manager_id,
        'actor_manager_name', actor.display_name,
        'actor_club_id', item.actor_club_id,
        'actor_club_name', coalesce(actor_club.name, item.actor_club_id),
        'related_club_id', item.related_club_id,
        'related_deal_id', item.related_deal_id,
        'metadata', item.metadata,
        'created_at', item.created_at,
        'activity_at', item.activity_at,
        'pinned_at', item.pinned_at,
        'comments', coalesce(comment_rows.comments, '[]'::jsonb)
      )
      order by
        (item.pinned_at is not null) desc,
        item.pinned_at desc nulls last,
        item.activity_at desc,
        item.created_at desc,
        item.id desc
    ), '[]'::jsonb
  ) into result_value
  from limited_items item
  left join public.manager_profiles actor on actor.id = item.actor_manager_id
  left join public.clubs actor_club on actor_club.id = item.actor_club_id and actor_club.world_id = item.world_id
  left join comment_rows on comment_rows.feed_item_id = item.id;

  return jsonb_build_object(
    'world_id', p_world_id,
    'club_id', club_id_value,
    'manager_id', manager_id_value,
    'can_moderate', can_moderate_value,
    'items', result_value
  );
end;
$phase_c$;

revoke all on function public.ensure_object_discussion_for_user(uuid,text,text,text,text)
  from public, anon, authenticated;
revoke all on function public.get_object_discussion_for_user(uuid,text,text,text,text)
  from public, anon, authenticated;
revoke all on function public.create_object_discussion_comment_for_user(uuid,text,text,text,text,text,uuid)
  from public, anon, authenticated;

grant execute on function public.ensure_object_discussion_for_user(uuid,text,text,text,text) to service_role;
grant execute on function public.get_object_discussion_for_user(uuid,text,text,text,text) to service_role;
grant execute on function public.create_object_discussion_comment_for_user(uuid,text,text,text,text,text,uuid) to service_role;

comment on column public.world_feed_items.object_type is
  'Canonical TBG object type for hidden object-discussion anchors only.';
comment on column public.world_feed_items.object_id is
  'Canonical TBG object identity; URLs/titles are presentation metadata, never identity.';
comment on column public.world_feed_items.object_title is
  'Presentation snapshot for an object discussion. Does not define canonical identity.';

commit;
