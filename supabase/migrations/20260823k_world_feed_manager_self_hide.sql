-- #290 follow-up: managers may hide their own World Feed posts without deleting audit history.

begin;

create or replace function public.hide_world_feed_item_for_user(
  p_user_id uuid,
  p_world_id text,
  p_feed_item_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  manager_id_value uuid;
  is_admin_value boolean := false;
  item_type_value text;
begin
  select profile.id, coalesce(profile.is_admin, false)
    into manager_id_value, is_admin_value
  from public.manager_profiles profile
  where profile.user_id = p_user_id
  limit 1;

  if manager_id_value is null then
    raise exception 'Manager profile has not been created yet';
  end if;

  update public.world_feed_items item
  set
    hidden_at = coalesce(item.hidden_at, now()),
    hidden_by_manager_id = manager_id_value
  where item.id = p_feed_item_id
    and item.world_id = p_world_id
    and item.hidden_at is null
    and (
      is_admin_value
      or (
        item.item_type = 'manager_post'
        and item.actor_manager_id = manager_id_value
      )
    )
  returning item.item_type into item_type_value;

  if not found then
    raise exception 'You can only hide your own manager posts';
  end if;

  return jsonb_build_object(
    'id', p_feed_item_id,
    'hidden', true,
    'item_type', item_type_value
  );
end;
$$;

revoke all on function public.hide_world_feed_item_for_user(uuid,text,uuid) from public, anon, authenticated;
grant execute on function public.hide_world_feed_item_for_user(uuid,text,uuid) to service_role;

commit;
