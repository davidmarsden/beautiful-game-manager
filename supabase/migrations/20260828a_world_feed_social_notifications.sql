begin;

alter table public.world_feed_comments
  add column if not exists parent_comment_id uuid references public.world_feed_comments(id) on delete set null;

create index if not exists world_feed_comments_parent_idx
  on public.world_feed_comments(parent_comment_id)
  where parent_comment_id is not null;

-- Keep the hot News read path relational while exposing the reply relationship.
create or replace function public.get_manager_world_feed_for_user(
  p_user_id uuid,
  p_world_id text,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $function$
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
    where comment.hidden_at is null
    group by comment.feed_item_id
  ),
  limited_items as (
    select item.*, greatest(item.created_at, coalesce(comment_activity.latest_comment_at, item.created_at)) as activity_at
    from public.world_feed_items item
    left join comment_activity on comment_activity.feed_item_id = item.id
    where item.world_id = p_world_id and item.hidden_at is null
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
$function$;

-- Replace the flat-comment writer with a reply-aware writer. Notifications are
-- emitted in the same transaction as the comment, so a successful social action
-- cannot exist without its corresponding canonical in-app notification.
drop function if exists public.create_manager_world_feed_comment_for_user(uuid, text, uuid, text);

create function public.create_manager_world_feed_comment_for_user(
  p_user_id uuid,
  p_world_id text,
  p_feed_item_id uuid,
  p_body text,
  p_parent_comment_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  manager_row public.manager_profiles;
  club_id_value text;
  item_row public.world_feed_items;
  parent_row public.world_feed_comments;
  parent_manager_name text;
  comment_row public.world_feed_comments;
  normalized_body text;
  action_url_value text;
begin
  normalized_body := trim(coalesce(p_body, ''));
  if normalized_body = '' or char_length(normalized_body) > 2000 then
    raise exception 'Comment must be between 1 and 2000 characters';
  end if;

  select profile.*, appointment.club_id into manager_row, club_id_value
  from public.manager_profiles profile
  join public.manager_appointments appointment
    on appointment.manager_id = profile.id
   and appointment.world_id = p_world_id
   and appointment.status = 'active'
  where profile.user_id = p_user_id
  limit 1;
  if manager_row.id is null then raise exception 'No active manager appointment for this user and world'; end if;

  select * into item_row
  from public.world_feed_items
  where id = p_feed_item_id and world_id = p_world_id and hidden_at is null
  limit 1;
  if item_row.id is null then raise exception 'Feed item is unavailable'; end if;

  if p_parent_comment_id is not null then
    select comment.*, profile.display_name
      into parent_row, parent_manager_name
    from public.world_feed_comments comment
    join public.manager_profiles profile on profile.id = comment.manager_id
    where comment.id = p_parent_comment_id
      and comment.feed_item_id = p_feed_item_id
      and comment.hidden_at is null
    limit 1;
    if parent_row.id is null then raise exception 'Reply target is unavailable'; end if;
  end if;

  insert into public.world_feed_comments(feed_item_id, manager_id, club_id, body, parent_comment_id)
  values(p_feed_item_id, manager_row.id, club_id_value, normalized_body, p_parent_comment_id)
  returning * into comment_row;

  action_url_value := '/?view=feed&feed_item=' || p_feed_item_id::text || '&comment=' || comment_row.id::text;

  -- A direct reply is the more specific event. If the replied-to manager also
  -- owns the post, send one reply notification rather than two notifications.
  if parent_row.id is not null and parent_row.manager_id <> manager_row.id then
    insert into public.manager_notifications(
      world_id, manager_id, notification_type, notification_class, title, body,
      action_url, source_type, source_id, dedupe_key, created_at
    ) values (
      p_world_id,
      parent_row.manager_id,
      'news_comment_reply',
      'info',
      'New reply to your comment',
      manager_row.display_name || ' replied to your comment on News.',
      action_url_value,
      'world_feed_comment',
      comment_row.id::text,
      'world_feed_comment:' || comment_row.id::text || ':reply',
      comment_row.created_at
    ) on conflict(manager_id, dedupe_key) do nothing;
  end if;

  if item_row.item_type = 'manager_post'
     and item_row.actor_manager_id is not null
     and item_row.actor_manager_id <> manager_row.id
     and (parent_row.id is null or item_row.actor_manager_id <> parent_row.manager_id) then
    insert into public.manager_notifications(
      world_id, manager_id, notification_type, notification_class, title, body,
      action_url, source_type, source_id, dedupe_key, created_at
    ) values (
      p_world_id,
      item_row.actor_manager_id,
      'news_post_comment',
      'info',
      'New comment on your News post',
      manager_row.display_name || ' commented on your News post.',
      action_url_value,
      'world_feed_comment',
      comment_row.id::text,
      'world_feed_comment:' || comment_row.id::text || ':post',
      comment_row.created_at
    ) on conflict(manager_id, dedupe_key) do nothing;
  end if;

  return jsonb_build_object(
    'id', comment_row.id,
    'parent_comment_id', comment_row.parent_comment_id,
    'created_at', comment_row.created_at
  );
end;
$$;

revoke all on function public.create_manager_world_feed_comment_for_user(uuid, text, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.create_manager_world_feed_comment_for_user(uuid, text, uuid, text, uuid) to service_role;

comment on function public.create_manager_world_feed_comment_for_user(uuid, text, uuid, text, uuid) is
  'Creates a News comment or direct reply and emits deduplicated manager_notifications for post owners and replied-to managers, excluding self-notifications.';

commit;
