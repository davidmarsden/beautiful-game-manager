-- Phase C live fixes:
-- 1. News already owns its canonical comment thread; do not fork a second discussion.
-- 2. Played fixtures may live only in canonical_match_archives.
-- 3. Preserve any early news-discussion comments by folding them into the source News item.

begin;

-- Fold any already-created News discussion-anchor comments back into the
-- canonical News item before the UI stops exposing the duplicate mechanism.
update public.world_feed_comments comment
set feed_item_id = source_item.id
from public.world_feed_items anchor,
     public.world_feed_items source_item
where comment.feed_item_id = anchor.id
  and anchor.item_type = 'object_discussion'
  and anchor.object_type = 'news'
  and source_item.world_id = anchor.world_id
  and source_item.id::text = anchor.object_id
  and source_item.item_type <> 'object_discussion';

delete from public.world_feed_items anchor
using public.world_feed_items source_item
where anchor.item_type = 'object_discussion'
  and anchor.object_type = 'news'
  and source_item.world_id = anchor.world_id
  and source_item.id::text = anchor.object_id
  and source_item.item_type <> 'object_discussion';

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
as $phase_c_fix$
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

  -- News already has one canonical public discussion: its own comment thread.
  -- Return the source item itself instead of creating a hidden parallel anchor.
  if normalized_type = 'news' then
    select item.id into discussion_id
    from public.world_feed_items item
    where item.world_id = p_world_id
      and item.id::text = normalized_id
      and item.hidden_at is null
      and item.item_type <> 'object_discussion'
    limit 1;

    if discussion_id is null then
      raise exception 'Object discussion unavailable';
    end if;
    return discussion_id;
  end if;

  if normalized_type = 'club' then
    select exists (
      select 1 from public.clubs club
      where club.world_id = p_world_id and club.id = normalized_id
    ) into object_exists;
  elsif normalized_type = 'fixture' then
    select (
      exists (
        select 1 from public.fixtures fixture
        where fixture.world_id = p_world_id and fixture.id = normalized_id
      )
      or exists (
        select 1 from public.canonical_match_archives archive
        where archive.world_id = p_world_id and archive.fixture_id = normalized_id
      )
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
    left('Discussion · ' || normalized_title, 160),
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
  do nothing
  returning id into discussion_id;

  if discussion_id is null then
    select item.id into discussion_id
    from public.world_feed_items item
    where item.world_id = p_world_id
      and item.item_type = 'object_discussion'
      and item.object_type = normalized_type
      and item.object_id = normalized_id
      and item.hidden_at is null
    limit 1;
  end if;

  if discussion_id is null then
    raise exception 'Object discussion unavailable';
  end if;

  return discussion_id;
end;
$phase_c_fix$;

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
as $phase_c_fix$
declare
  normalized_type text := lower(trim(coalesce(p_object_type, '')));
  normalized_id text := trim(coalesce(p_object_id, ''));
  discussion_id uuid;
  result_value jsonb;
begin
  discussion_id := public.ensure_object_discussion_for_user(
    p_user_id, p_world_id, normalized_type, normalized_id, p_object_title
  );

  select jsonb_build_object(
    'id', item.id,
    'object_type', case when normalized_type = 'news' then 'news' else item.object_type end,
    'object_id', case when normalized_type = 'news' then item.id::text else item.object_id end,
    'object_title', case when normalized_type = 'news' then item.title else item.object_title end,
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
$phase_c_fix$;

revoke all on function public.ensure_object_discussion_for_user(uuid,text,text,text,text)
  from public, anon, authenticated;
revoke all on function public.get_object_discussion_for_user(uuid,text,text,text,text)
  from public, anon, authenticated;
grant execute on function public.ensure_object_discussion_for_user(uuid,text,text,text,text) to service_role;
grant execute on function public.get_object_discussion_for_user(uuid,text,text,text,text) to service_role;

commit;
