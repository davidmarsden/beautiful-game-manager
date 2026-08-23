begin;

create or replace function public.get_manager_transfer_listings_for_user(
  p_user_id uuid,
  p_world_id text
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  manager_id_value uuid;
  club_id_value text;
  cache_row public.world_read_model_cache;
  canonical_checksum text;
  listings_value jsonb;
begin
  if p_user_id is null then
    raise exception 'Verified user identity is required';
  end if;

  select profile.id, appointment.club_id
    into manager_id_value, club_id_value
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

  select save_checksum
    into canonical_checksum
  from public.canonical_world_saves
  where world_id = p_world_id
  limit 1;

  select *
    into cache_row
  from public.world_read_model_cache
  where world_id = p_world_id
  limit 1;

  if cache_row.read_model is null
     or canonical_checksum is null
     or cache_row.source_checksum <> canonical_checksum then
    raise exception 'World read model is refreshing; please retry shortly';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'listing_id', listing.id,
    'player_id', listing.player_id,
    'player_name', coalesce(
      cache_row.read_model #>> array['squad_cycle','players',listing.player_id,'display_name'],
      cache_row.read_model #>> array['squad_cycle','players',listing.player_id,'player_name'],
      listing.player_id
    ),
    'club_id', listing.club_id,
    'asking_fee', listing.asking_fee,
    'status', listing.status,
    'created_at', listing.created_at,
    'updated_at', listing.updated_at,
    'is_own_listing', listing.club_id = club_id_value
  ) order by listing.updated_at desc), '[]'::jsonb)
  into listings_value
  from public.transfer_market_listings listing
  where listing.world_id = p_world_id
    and listing.status = 'active'
    and coalesce(
      cache_row.read_model #>> array['squad_cycle','players',listing.player_id,'club_id'],
      ''
    ) = listing.club_id;

  return jsonb_build_object(
    'world_id', p_world_id,
    'club_id', club_id_value,
    'listings', listings_value
  );
end;
$$;

revoke all on function public.get_manager_transfer_listings_for_user(uuid,text)
  from public, anon, authenticated;
grant execute on function public.get_manager_transfer_listings_for_user(uuid,text)
  to service_role;

commit;
