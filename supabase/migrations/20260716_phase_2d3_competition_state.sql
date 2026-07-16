begin;

create table if not exists public.competition_standings (
  world_id text not null,
  season_id text not null,
  competition_id text not null,
  club_id text not null,
  position integer not null default 0,
  played integer not null default 0,
  won integer not null default 0,
  drawn integer not null default 0,
  lost integer not null default 0,
  goals_for integer not null default 0,
  goals_against integer not null default 0,
  goal_difference integer not null default 0,
  points integer not null default 0,
  form jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (world_id, season_id, competition_id, club_id)
);

create index if not exists competition_standings_order_idx
  on public.competition_standings
  (world_id, season_id, competition_id, points desc, goal_difference desc, goals_for desc, club_id);

alter table public.competition_standings enable row level security;

drop policy if exists "authenticated managers can read competition standings" on public.competition_standings;
create policy "authenticated managers can read competition standings"
  on public.competition_standings for select to authenticated
  using (true);

create or replace function public.rebuild_competition_standings(
  target_world_id text,
  target_season_id text,
  target_competition_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Only one transaction may rebuild a given competition table at a time.
  perform pg_advisory_xact_lock(
    hashtextextended(
      concat_ws('|', target_world_id, target_season_id, target_competition_id),
      0
    )
  );

  delete from public.competition_standings
  where world_id = target_world_id
    and season_id = target_season_id
    and competition_id = target_competition_id;

  insert into public.competition_standings (
    world_id, season_id, competition_id, club_id,
    position, played, won, drawn, lost,
    goals_for, goals_against, goal_difference, points, form, updated_at
  )
  with competition_fixtures as (
    select *
    from public.fixtures
    where world_id = target_world_id
      and season_id = target_season_id
      and competition_id = target_competition_id
  ),
  member_clubs as (
    select home_club_id as club_id from competition_fixtures
    union
    select away_club_id as club_id from competition_fixtures
  ),
  played_fixtures as (
    select *
    from competition_fixtures
    where status = 'played'
      and home_score is not null
      and away_score is not null
  ),
  club_results as (
    select id as fixture_id, played_at, home_club_id as club_id,
           home_score as goals_for, away_score as goals_against,
           case when home_score > away_score then 'W' when home_score = away_score then 'D' else 'L' end as outcome
    from played_fixtures
    union all
    select id, played_at, away_club_id,
           away_score, home_score,
           case when away_score > home_score then 'W' when away_score = home_score then 'D' else 'L' end
    from played_fixtures
  ),
  totals as (
    select members.club_id,
           count(results.fixture_id)::integer as played,
           count(results.fixture_id) filter (where results.outcome = 'W')::integer as won,
           count(results.fixture_id) filter (where results.outcome = 'D')::integer as drawn,
           count(results.fixture_id) filter (where results.outcome = 'L')::integer as lost,
           coalesce(sum(results.goals_for), 0)::integer as goals_for,
           coalesce(sum(results.goals_against), 0)::integer as goals_against,
           (coalesce(sum(results.goals_for), 0) - coalesce(sum(results.goals_against), 0))::integer as goal_difference,
           (
             count(results.fixture_id) filter (where results.outcome = 'W') * 3
             + count(results.fixture_id) filter (where results.outcome = 'D')
           )::integer as points
    from member_clubs members
    left join club_results results using (club_id)
    group by members.club_id
  ),
  recent_form as (
    select club_id,
           jsonb_agg(outcome order by played_at, fixture_id) as form
    from (
      select club_id, fixture_id, played_at, outcome,
             row_number() over (partition by club_id order by played_at desc, fixture_id desc) as recent_rank
      from club_results
    ) ranked_results
    where recent_rank <= 5
    group by club_id
  ),
  ranked as (
    select totals.*,
           row_number() over (
             order by points desc, goal_difference desc, goals_for desc, club_id
           )::integer as position
    from totals
  )
  select target_world_id, target_season_id, target_competition_id, ranked.club_id,
         ranked.position, ranked.played, ranked.won, ranked.drawn, ranked.lost,
         ranked.goals_for, ranked.goals_against, ranked.goal_difference, ranked.points,
         coalesce(recent_form.form, '[]'::jsonb), now()
  from ranked
  left join recent_form using (club_id);
end;
$$;

create or replace function public.finalise_match_and_competition_state(
  fixture_key text,
  home_goals integer,
  away_goals integer,
  result_json jsonb,
  played_timestamp timestamptz default now()
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_fixture public.fixtures%rowtype;
begin
  select * into target_fixture
  from public.fixtures
  where id = fixture_key
  for update;

  if not found then
    raise exception 'Fixture % does not exist', fixture_key;
  end if;

  update public.fixtures
  set status = 'played',
      home_score = home_goals,
      away_score = away_goals,
      played_at = played_timestamp,
      result_payload = result_json,
      engine_run_status = 'completed',
      engine_processing_started_at = null,
      engine_completed_at = now(),
      engine_run_error = null
  where id = fixture_key;

  update public.match_runs
  set status = 'completed',
      completed_at = now(),
      updated_at = now(),
      last_error = null
  where fixture_id = fixture_key;

  perform public.rebuild_competition_standings(
    target_fixture.world_id,
    target_fixture.season_id,
    target_fixture.competition_id
  );
end;
$$;

-- Populate every scheduled competition immediately, including clubs on P=0.
do $$
declare
  competition record;
begin
  for competition in
    select distinct world_id, season_id, competition_id
    from public.fixtures
    where world_id is not null
      and season_id is not null
      and competition_id is not null
  loop
    perform public.rebuild_competition_standings(
      competition.world_id,
      competition.season_id,
      competition.competition_id
    );
  end loop;
end;
$$;

revoke all on function public.rebuild_competition_standings(text, text, text) from public, anon, authenticated;
revoke all on function public.finalise_match_and_competition_state(text, integer, integer, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.rebuild_competition_standings(text, text, text) to service_role;
grant execute on function public.finalise_match_and_competition_state(text, integer, integer, jsonb, timestamptz) to service_role;

commit;