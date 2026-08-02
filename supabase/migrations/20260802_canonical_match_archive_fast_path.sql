create table if not exists public.canonical_match_archives (
  fixture_id text primary key,
  world_id text not null,
  season_id text not null,
  competition_id text not null,
  matchday integer not null,
  home_club_id text not null,
  away_club_id text not null,
  played_at timestamptz,
  archive_payload jsonb not null,
  source_checksum text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists canonical_match_archives_world_matchday_idx
  on public.canonical_match_archives (world_id, season_id, matchday desc);

alter table public.canonical_match_archives enable row level security;
revoke all on public.canonical_match_archives from public, anon;
grant select on public.canonical_match_archives to authenticated;

drop policy if exists "appointed managers can read canonical match archives" on public.canonical_match_archives;
create policy "appointed managers can read canonical match archives"
  on public.canonical_match_archives
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.manager_profiles mp
      join public.manager_appointments ma on ma.manager_id = mp.id
      where mp.user_id = auth.uid()
        and ma.status = 'active'
        and ma.world_id = canonical_match_archives.world_id
    )
  );

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
  v_home_id text;
  v_away_id text;
  v_players jsonb;
begin
  if v_world is null or jsonb_typeof(v_world) <> 'object' then
    return new;
  end if;

  for v_runtime in
    select key as competition_id, value as runtime
    from jsonb_each(coalesce(v_world->'matchday_cycle'->'runtimes', '{}'::jsonb))
  loop
    for v_result in
      select value from jsonb_array_elements(coalesce(v_runtime.runtime->'results', '[]'::jsonb))
    loop
      v_fixture_id := coalesce(
        nullif(v_result->'fixture'->>'fixture_id', ''),
        nullif(v_result->>'fixture_id', '')
      );
      if v_fixture_id is null then
        continue;
      end if;

      v_fixture := null;
      select value into v_fixture
      from jsonb_array_elements(coalesce(v_runtime.runtime->'fixtures', '[]'::jsonb))
      where value->>'fixture_id' = v_fixture_id
      limit 1;

      v_fixture := coalesce(v_fixture, v_result->'fixture', jsonb_build_object(
        'fixture_id', v_fixture_id,
        'home_club_id', v_result->>'home_club_id',
        'away_club_id', v_result->>'away_club_id',
        'matchday', v_result->>'matchday'
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
        coalesce((v_fixture->>'matchday')::integer, (v_result->>'matchday')::integer, new.matchday - 1),
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

drop trigger if exists canonical_world_save_match_archive_refresh on public.canonical_world_saves;
create trigger canonical_world_save_match_archive_refresh
after insert or update of save_envelope on public.canonical_world_saves
for each row execute function public.refresh_canonical_match_archives_from_save();

update public.canonical_world_saves
set save_envelope = save_envelope
where save_envelope is not null;
