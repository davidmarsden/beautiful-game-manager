-- Matchday checkpoint hardening: archive only the matchday completed by this checkpoint.
-- This keeps checkpoint cost bounded while allowing a restored fixture to replace
-- an archive from an abandoned timeline when that fixture is replayed.

create or replace function public.refresh_canonical_match_archives_from_save()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_world jsonb := new.save_envelope->'world';
  v_runtime record;
  v_result jsonb;
  v_fixture jsonb;
  v_fixture_id text;
  v_result_matchday integer;
  v_completed_matchday integer;
  v_home_id text;
  v_away_id text;
  v_players jsonb;
begin
  if v_world is null or jsonb_typeof(v_world) <> 'object' then
    return new;
  end if;

  -- During an ordinary season checkpoint the persisted matchday cursor points
  -- at the next round, so only the immediately preceding matchday can have new
  -- canonical results. A restore/replay of that round uses the same rule and
  -- therefore refreshes the abandoned timeline's archive rows.
  v_completed_matchday := case
    when new.matchday is not null and new.matchday > 1 then new.matchday - 1
    else null
  end;

  if v_completed_matchday is null then
    return new;
  end if;

  for v_runtime in
    select key as competition_id, value as runtime
    from jsonb_each(coalesce(v_world->'matchday_cycle'->'runtimes', '{}'::jsonb))
  loop
    for v_result in
      select value from jsonb_array_elements(coalesce(v_runtime.runtime->'results', '[]'::jsonb))
    loop
      v_fixture := v_result->'fixture';
      v_result_matchday := coalesce(
        nullif(v_fixture->>'matchday', '')::integer,
        nullif(v_result->>'matchday', '')::integer
      );

      if v_result_matchday is distinct from v_completed_matchday then
        continue;
      end if;

      v_fixture_id := coalesce(
        nullif(v_fixture->>'fixture_id', ''),
        nullif(v_result->>'fixture_id', '')
      );
      if v_fixture_id is null then
        continue;
      end if;

      -- Incremental results normally carry their fixture already. Only fall
      -- back to the season fixture array for older/legacy result shapes.
      if v_fixture is null or jsonb_typeof(v_fixture) <> 'object' then
        select value into v_fixture
        from jsonb_array_elements(coalesce(v_runtime.runtime->'fixtures', '[]'::jsonb))
        where value->>'fixture_id' = v_fixture_id
        limit 1;
      end if;

      v_fixture := coalesce(v_fixture, jsonb_build_object(
        'fixture_id', v_fixture_id,
        'home_club_id', v_result->>'home_club_id',
        'away_club_id', v_result->>'away_club_id',
        'matchday', v_result_matchday
      ));
      v_home_id := coalesce(nullif(v_fixture->>'home_club_id', ''), nullif(v_result->>'home_club_id', ''));
      v_away_id := coalesce(nullif(v_fixture->>'away_club_id', ''), nullif(v_result->>'away_club_id', ''));
      if v_home_id is null or v_away_id is null then
        continue;
      end if;

      select coalesce(jsonb_object_agg(ids.player_id, v_world->'squad_cycle'->'players'->ids.player_id), '{}'::jsonb)
      into v_players
      from (
        select distinct player_id
        from (
          select jsonb_array_elements_text(coalesce(v_world->'squad_cycle'->'clubs'->v_home_id->'player_ids', '[]'::jsonb)) as player_id
          union all
          select jsonb_array_elements_text(coalesce(v_world->'squad_cycle'->'clubs'->v_away_id->'player_ids', '[]'::jsonb)) as player_id
        ) club_players
      ) ids
      where (v_world->'squad_cycle'->'players') ? ids.player_id;

      insert into public.canonical_match_archives (
        fixture_id, world_id, season_id, competition_id, matchday,
        home_club_id, away_club_id, played_at, archive_payload,
        source_checksum, updated_at
      ) values (
        v_fixture_id,
        new.world_id,
        coalesce(v_world->'matchday_cycle'->>'season_id', new.season_id),
        v_runtime.competition_id,
        v_result_matchday,
        v_home_id,
        v_away_id,
        nullif(coalesce(v_fixture->>'kickoff_at', v_result->'fixture'->>'kickoff_at', v_result->>'played_at'), '')::timestamptz,
        jsonb_build_object(
          'fixture', v_fixture,
          'result', v_result,
          'club_profiles', jsonb_strip_nulls(jsonb_build_object(
            v_home_id, v_world->'club_profiles'->v_home_id,
            v_away_id, v_world->'club_profiles'->v_away_id
          )),
          'players', coalesce(v_players, '{}'::jsonb)
        ),
        new.save_checksum,
        now()
      )
      on conflict (fixture_id) do update
        set world_id = excluded.world_id,
            season_id = excluded.season_id,
            competition_id = excluded.competition_id,
            matchday = excluded.matchday,
            home_club_id = excluded.home_club_id,
            away_club_id = excluded.away_club_id,
            played_at = excluded.played_at,
            archive_payload = excluded.archive_payload,
            source_checksum = excluded.source_checksum,
            updated_at = now();
    end loop;
  end loop;

  return new;
end;
$$;

revoke all on function public.refresh_canonical_match_archives_from_save() from public, anon, authenticated;
