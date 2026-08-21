begin;

create or replace function public.get_player_profile_performance_stats_for_user(
  p_user_id uuid,
  p_world_id text,
  p_player_id text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  appointed boolean;
  current_season_id text;
  result jsonb;
begin
  if p_user_id is null then raise exception 'Verified user identity is required'; end if;
  if trim(coalesce(p_world_id, '')) = '' then raise exception 'World is required'; end if;
  if trim(coalesce(p_player_id, '')) = '' then raise exception 'Player is required'; end if;

  select exists (
    select 1
    from public.manager_profiles profile
    join public.manager_appointments appointment
      on appointment.manager_id = profile.id
     and appointment.world_id = p_world_id
     and appointment.status = 'active'
    where profile.user_id = p_user_id
  ) into appointed;
  if not appointed then raise exception 'No active manager appointment for this world'; end if;

  select season_id into current_season_id
  from public.canonical_world_saves
  where world_id = p_world_id
  limit 1;
  if current_season_id is null then raise exception 'Canonical world not found'; end if;

  with matches as (
    select c.fixture_id, c.matchday, c.played_at, c.archive_payload -> 'result' as result
    from public.canonical_match_archives c
    where c.world_id = p_world_id
      and c.season_id = current_season_id
  ), appearances as (
    select m.fixture_id, m.matchday, m.played_at, rating_row
    from matches m
    cross join lateral jsonb_array_elements(
      coalesce(m.result -> 'player_ratings' -> 'home', '[]'::jsonb)
      || coalesce(m.result -> 'player_ratings' -> 'away', '[]'::jsonb)
    ) rating_row
    where rating_row ->> 'player_id' = p_player_id
  ), rated as (
    select fixture_id, matchday, played_at, rating_row
    from appearances
    where coalesce(rating_row ->> 'rating', '') ~ '^[0-9]+([.][0-9]+)?$'
  ), event_totals as (
    select
      count(*) filter (
        where event_row ->> 'type' = 'goal'
          and event_row ->> 'player_id' = p_player_id
          and coalesce(event_row ->> 'own_goal', 'false') <> 'true'
          and coalesce((event_row ->> 'official')::boolean, true)
      )::integer as goals,
      count(*) filter (
        where event_row ->> 'type' = 'goal'
          and event_row ->> 'assist_player_id' = p_player_id
          and coalesce((event_row ->> 'official')::boolean, true)
      )::integer as assists
    from matches m
    cross join lateral jsonb_array_elements(coalesce(m.result -> 'events', '[]'::jsonb)) event_row
  ), recent as (
    select fixture_id, matchday, played_at, (rating_row ->> 'rating')::numeric as rating,
           nullif(rating_row ->> 'minutes_played', '')::integer as minutes_played
    from rated
    order by played_at desc, fixture_id desc
    limit 5
  )
  select jsonb_build_object(
    'world_id', p_world_id,
    'season_id', current_season_id,
    'player_id', p_player_id,
    'appearances', (select count(*)::integer from appearances),
    'goals', coalesce((select goals from event_totals), 0),
    'assists', coalesce((select assists from event_totals), 0),
    'average_match_rating', (select round(avg((rating_row ->> 'rating')::numeric), 2) from rated),
    'recent_ratings', coalesce((select jsonb_agg(jsonb_build_object(
      'fixture_id', fixture_id,
      'matchday', matchday,
      'played_at', played_at,
      'rating', rating,
      'minutes_played', minutes_played
    ) order by played_at desc, fixture_id desc) from recent), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

revoke all on function public.get_player_profile_performance_stats_for_user(uuid,text,text)
  from public, anon, authenticated;
grant execute on function public.get_player_profile_performance_stats_for_user(uuid,text,text)
  to service_role;

commit;
