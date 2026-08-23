-- World Feed social activity pulse: a narrow participation signal, not a manager-performance score.

begin;

create or replace function public.get_world_feed_social_activity_for_user(
  p_user_id uuid,
  p_world_id text,
  p_days integer default 30
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  caller_manager_id uuid;
  caller_is_admin boolean := false;
  days_value integer := greatest(1, least(coalesce(p_days, 30), 365));
  cutoff_value timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 365)));
  current_value jsonb;
  managers_value jsonb := '[]'::jsonb;
begin
  select profile.id, coalesce(profile.is_admin, false)
    into caller_manager_id, caller_is_admin
  from public.manager_profiles profile
  join public.manager_appointments appointment
    on appointment.manager_id = profile.id
   and appointment.world_id = p_world_id
   and appointment.status = 'active'
  where profile.user_id = p_user_id
  limit 1;

  if caller_manager_id is null then
    raise exception 'No active manager appointment for this user and world';
  end if;

  with manager_stats as (
    select
      profile.id as manager_id,
      profile.display_name as manager_name,
      appointment.club_id,
      coalesce(
        cache.read_model #>> array['club_profiles', appointment.club_id, 'club_name'],
        cache.read_model #>> array['club_profiles', appointment.club_id, 'canonical_name'],
        appointment.club_id
      ) as club_name,
      coalesce((
        select count(*)::integer
        from public.world_feed_items item
        where item.world_id = p_world_id
          and item.item_type = 'manager_post'
          and item.actor_manager_id = profile.id
          and item.hidden_at is null
          and item.created_at >= cutoff_value
      ), 0) as posts,
      coalesce((
        select count(*)::integer
        from public.world_feed_comments comment
        join public.world_feed_items item on item.id = comment.feed_item_id
        where item.world_id = p_world_id
          and comment.manager_id = profile.id
          and comment.hidden_at is null
          and item.hidden_at is null
          and comment.created_at >= cutoff_value
      ), 0) as comments_made,
      coalesce((
        select count(*)::integer
        from public.world_feed_comments comment
        join public.world_feed_items item on item.id = comment.feed_item_id
        where item.world_id = p_world_id
          and item.item_type = 'manager_post'
          and item.actor_manager_id = profile.id
          and comment.manager_id <> profile.id
          and comment.hidden_at is null
          and item.hidden_at is null
          and comment.created_at >= cutoff_value
      ), 0) as comments_received_from_others,
      greatest(
        (select max(item.created_at)
         from public.world_feed_items item
         where item.world_id = p_world_id
           and item.item_type = 'manager_post'
           and item.actor_manager_id = profile.id
           and item.hidden_at is null),
        (select max(comment.created_at)
         from public.world_feed_comments comment
         join public.world_feed_items item on item.id = comment.feed_item_id
         where item.world_id = p_world_id
           and comment.manager_id = profile.id
           and comment.hidden_at is null
           and item.hidden_at is null)
      ) as last_social_activity_at
    from public.manager_profiles profile
    join public.manager_appointments appointment
      on appointment.manager_id = profile.id
     and appointment.world_id = p_world_id
     and appointment.status = 'active'
    join public.world_read_model_cache cache on cache.world_id = appointment.world_id
    join public.canonical_world_saves canonical
      on canonical.world_id = cache.world_id
     and canonical.save_checksum = cache.source_checksum
  ), shaped as (
    select
      manager_id,
      jsonb_build_object(
        'manager_id', manager_id,
        'manager_name', manager_name,
        'club_id', club_id,
        'club_name', club_name,
        'posts', posts,
        'comments_made', comments_made,
        'comments_received_from_others', comments_received_from_others,
        'social_actions', posts + comments_made,
        'last_social_activity_at', last_social_activity_at,
        'inactive_days', case
          when last_social_activity_at is null then null
          else floor(extract(epoch from (now() - last_social_activity_at)) / 86400)::integer
        end
      ) as row_value,
      last_social_activity_at,
      manager_name
    from manager_stats
  )
  select row_value into current_value
  from shaped
  where manager_id = caller_manager_id;

  if caller_is_admin then
    with manager_stats as (
      select
        profile.id as manager_id,
        profile.display_name as manager_name,
        appointment.club_id,
        coalesce(
          cache.read_model #>> array['club_profiles', appointment.club_id, 'club_name'],
          cache.read_model #>> array['club_profiles', appointment.club_id, 'canonical_name'],
          appointment.club_id
        ) as club_name,
        coalesce((select count(*)::integer from public.world_feed_items item where item.world_id = p_world_id and item.item_type = 'manager_post' and item.actor_manager_id = profile.id and item.hidden_at is null and item.created_at >= cutoff_value), 0) as posts,
        coalesce((select count(*)::integer from public.world_feed_comments comment join public.world_feed_items item on item.id = comment.feed_item_id where item.world_id = p_world_id and comment.manager_id = profile.id and comment.hidden_at is null and item.hidden_at is null and comment.created_at >= cutoff_value), 0) as comments_made,
        coalesce((select count(*)::integer from public.world_feed_comments comment join public.world_feed_items item on item.id = comment.feed_item_id where item.world_id = p_world_id and item.item_type = 'manager_post' and item.actor_manager_id = profile.id and comment.manager_id <> profile.id and comment.hidden_at is null and item.hidden_at is null and comment.created_at >= cutoff_value), 0) as comments_received_from_others,
        greatest(
          (select max(item.created_at) from public.world_feed_items item where item.world_id = p_world_id and item.item_type = 'manager_post' and item.actor_manager_id = profile.id and item.hidden_at is null),
          (select max(comment.created_at) from public.world_feed_comments comment join public.world_feed_items item on item.id = comment.feed_item_id where item.world_id = p_world_id and comment.manager_id = profile.id and comment.hidden_at is null and item.hidden_at is null)
        ) as last_social_activity_at
      from public.manager_profiles profile
      join public.manager_appointments appointment on appointment.manager_id = profile.id and appointment.world_id = p_world_id and appointment.status = 'active'
      join public.world_read_model_cache cache on cache.world_id = appointment.world_id
      join public.canonical_world_saves canonical on canonical.world_id = cache.world_id and canonical.save_checksum = cache.source_checksum
    )
    select coalesce(jsonb_agg(jsonb_build_object(
      'manager_id', manager_id,
      'manager_name', manager_name,
      'club_id', club_id,
      'club_name', club_name,
      'posts', posts,
      'comments_made', comments_made,
      'comments_received_from_others', comments_received_from_others,
      'social_actions', posts + comments_made,
      'last_social_activity_at', last_social_activity_at,
      'inactive_days', case when last_social_activity_at is null then null else floor(extract(epoch from (now() - last_social_activity_at)) / 86400)::integer end
    ) order by last_social_activity_at desc nulls last, manager_name), '[]'::jsonb)
      into managers_value
    from manager_stats;
  end if;

  return jsonb_build_object(
    'world_id', p_world_id,
    'window_days', days_value,
    'current', coalesce(current_value, '{}'::jsonb),
    'managers', managers_value,
    'can_view_roster', caller_is_admin
  );
end;
$$;

revoke all on function public.get_world_feed_social_activity_for_user(uuid,text,integer) from public, anon, authenticated;
grant execute on function public.get_world_feed_social_activity_for_user(uuid,text,integer) to service_role;

commit;
