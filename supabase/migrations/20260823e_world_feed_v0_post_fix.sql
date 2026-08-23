-- #290 follow-up: keep the manager post gateway strictly server-derived.

begin;

create or replace function public.create_manager_world_feed_post_for_user(
  p_user_id uuid,
  p_world_id text,
  p_body text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  manager_row public.manager_profiles;
  club_id_value text;
  item_row public.world_feed_items;
  normalized_body text;
begin
  normalized_body := trim(coalesce(p_body, ''));
  if normalized_body = '' or char_length(normalized_body) > 4000 then
    raise exception 'Post must be between 1 and 4000 characters';
  end if;

  select profile, appointment.club_id
    into manager_row, club_id_value
  from public.manager_profiles profile
  join public.manager_appointments appointment
    on appointment.manager_id = profile.id
   and appointment.world_id = p_world_id
   and appointment.status = 'active'
  where profile.user_id = p_user_id
  limit 1;

  if manager_row.id is null then
    raise exception 'No active manager appointment for this user and world';
  end if;

  insert into public.world_feed_items(
    world_id, item_type, actor_manager_id, actor_club_id, title, body
  ) values (
    p_world_id,
    'manager_post',
    manager_row.id,
    club_id_value,
    manager_row.display_name || ' · Manager post',
    normalized_body
  ) returning * into item_row;

  return jsonb_build_object('id', item_row.id, 'created_at', item_row.created_at);
end;
$$;

revoke all on function public.create_manager_world_feed_post_for_user(uuid,text,text)
  from public, anon, authenticated;
grant execute on function public.create_manager_world_feed_post_for_user(uuid,text,text)
  to service_role;

commit;
