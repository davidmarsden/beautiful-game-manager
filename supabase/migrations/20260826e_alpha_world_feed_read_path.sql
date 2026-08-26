-- Controlled-alpha hardening: keep the News / World Feed read path off the
-- monolithic world JSONB read model.
--
-- Production profiling on 2026-08-26 showed the existing function taking
-- ~1841 ms with 17,636 shared-buffer hits for 59 items because club-name
-- resolution repeatedly traversed the toasted world read model.  The clubs
-- table already carries the same canonical display names for all 80 clubs.
-- A relational rewrite of the hot query profiled at ~3.7 ms / 89 buffer hits.

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
    select
      comment.feed_item_id,
      max(comment.created_at) as latest_comment_at
    from public.world_feed_comments comment
    join public.world_feed_items comment_item
      on comment_item.id = comment.feed_item_id
     and comment_item.world_id = p_world_id
    where comment.hidden_at is null
    group by comment.feed_item_id
  ),
  limited_items as (
    select
      item.*,
      greatest(item.created_at, coalesce(comment_activity.latest_comment_at, item.created_at)) as activity_at
    from public.world_feed_items item
    left join comment_activity
      on comment_activity.feed_item_id = item.id
    where item.world_id = p_world_id
      and item.hidden_at is null
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
          'manager_id', comment.manager_id,
          'manager_name', commenter.display_name,
          'club_id', comment.club_id,
          'club_name', coalesce(comment_club.name, comment.club_id),
          'body', comment.body,
          'created_at', comment.created_at,
          'edited_at', comment.edited_at
        )
        order by comment.created_at asc, comment.id asc
      ) as comments
    from limited_items limited_item
    join public.world_feed_comments comment
      on comment.feed_item_id = limited_item.id
     and comment.hidden_at is null
    join public.manager_profiles commenter
      on commenter.id = comment.manager_id
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
    ),
    '[]'::jsonb
  )
  into result_value
  from limited_items item
  left join public.manager_profiles actor
    on actor.id = item.actor_manager_id
  left join public.clubs actor_club
    on actor_club.id = item.actor_club_id
   and actor_club.world_id = item.world_id
  left join comment_rows
    on comment_rows.feed_item_id = item.id;

  return jsonb_build_object(
    'world_id', p_world_id,
    'club_id', club_id_value,
    'manager_id', manager_id_value,
    'can_moderate', can_moderate_value,
    'items', result_value
  );
end;
$function$;

comment on function public.get_manager_world_feed_for_user(uuid, text, integer) is
  'Returns the manager-visible World Feed using relational club names, lightweight activity aggregation and comment payloads bounded to the selected feed items; avoids monolithic world JSONB reads on the News hot path.';
