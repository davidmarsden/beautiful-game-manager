begin;

create or replace function public.get_manager_world_feed_item_for_user(
  p_user_id uuid,
  p_world_id text,
  p_feed_item_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  manager_id_value uuid;
  item_value jsonb;
begin
  select profile.id
    into manager_id_value
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

  select jsonb_build_object(
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
    'activity_at', greatest(item.created_at, coalesce(comment_activity.latest_comment_at, item.created_at)),
    'pinned_at', item.pinned_at,
    'comments', coalesce(comment_rows.comments, '[]'::jsonb)
  )
  into item_value
  from public.world_feed_items item
  left join public.manager_profiles actor
    on actor.id = item.actor_manager_id
  left join public.clubs actor_club
    on actor_club.id = item.actor_club_id
   and actor_club.world_id = item.world_id
  left join lateral (
    select max(comment.created_at) as latest_comment_at
    from public.world_feed_comments comment
    where comment.feed_item_id = item.id
      and comment.hidden_at is null
  ) comment_activity on true
  left join lateral (
    select jsonb_agg(
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
    from public.world_feed_comments comment
    join public.manager_profiles commenter
      on commenter.id = comment.manager_id
    left join public.clubs comment_club
      on comment_club.id = comment.club_id
     and comment_club.world_id = p_world_id
    where comment.feed_item_id = item.id
      and comment.hidden_at is null
  ) comment_rows on true
  where item.id = p_feed_item_id
    and item.world_id = p_world_id
    and item.hidden_at is null
  limit 1;

  return item_value;
end;
$function$;

revoke all on function public.get_manager_world_feed_item_for_user(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.get_manager_world_feed_item_for_user(uuid, text, uuid) to service_role;

comment on function public.get_manager_world_feed_item_for_user(uuid, text, uuid) is
  'Returns one visible News item with its visible comments for an active manager in the world, allowing notification deep links to resolve outside the normal feed window.';

commit;
