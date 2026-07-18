begin;

create table if not exists public.player_match_state (
  world_id text not null,
  player_id text not null,
  season_id text,
  fitness numeric(6,3) not null default 100 check (fitness between 0 and 100),
  sharpness numeric(6,3) not null default 100 check (sharpness between 0 and 100),
  morale numeric(6,3) not null default 50 check (morale between 0 and 100),
  injury_status text,
  injured_at timestamptz,
  yellow_cards integer not null default 0 check (yellow_cards >= 0),
  red_cards integer not null default 0 check (red_cards >= 0),
  suspended boolean not null default false,
  last_played_at timestamptz,
  last_run_key text,
  updated_at timestamptz not null default now(),
  primary key (world_id, player_id)
);

create index if not exists player_match_state_world_season_idx
  on public.player_match_state (world_id, season_id, player_id);

create table if not exists public.match_state_applications (
  run_key text primary key,
  fixture_id text not null references public.fixtures(id) on delete cascade,
  world_id text not null,
  season_id text,
  played_at timestamptz,
  payload jsonb not null,
  applied_at timestamptz not null default now()
);

create unique index if not exists match_state_applications_fixture_idx
  on public.match_state_applications (fixture_id);

alter table public.player_match_state enable row level security;
alter table public.match_state_applications enable row level security;

revoke all on public.player_match_state from public, anon, authenticated;
revoke all on public.match_state_applications from public, anon, authenticated;

create or replace function public.apply_match_state_changes(
  run_key text,
  fixture_key text,
  world_key text,
  season_key text,
  played_timestamp timestamptz,
  changes_json jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_run text;
  player_change jsonb;
  incoming_player_id text;
  incoming_fitness numeric;
  incoming_injury text;
  incoming_yellows integer;
  incoming_reds integer;
  incoming_sent_off boolean;
begin
  if coalesce(run_key, '') = '' then
    raise exception 'run_key is required';
  end if;
  if coalesce(fixture_key, '') = '' then
    raise exception 'fixture_key is required';
  end if;
  if coalesce(world_key, '') = '' then
    raise exception 'world_key is required';
  end if;

  insert into public.match_state_applications (
    run_key, fixture_id, world_id, season_id, played_at, payload
  ) values (
    run_key, fixture_key, world_key, season_key, played_timestamp, changes_json
  )
  on conflict (run_key) do nothing
  returning match_state_applications.run_key into inserted_run;

  if inserted_run is null then
    return false;
  end if;

  for player_change in
    select value from jsonb_array_elements(coalesce(changes_json->'players', '[]'::jsonb))
  loop
    incoming_player_id := nullif(player_change->>'player_id', '');
    if incoming_player_id is null then
      raise exception 'player_id is required for every match-state change';
    end if;

    incoming_fitness := greatest(0, least(100, coalesce((player_change->>'post_match_fitness')::numeric, 100)));
    incoming_injury := nullif(player_change->>'injury_status', '');
    incoming_yellows := greatest(0, coalesce((player_change->>'yellow_cards')::integer, 0));
    incoming_reds := greatest(0, coalesce((player_change->>'red_cards')::integer, 0));
    incoming_sent_off := coalesce((player_change->>'sent_off')::boolean, false);

    insert into public.player_match_state (
      world_id,
      player_id,
      season_id,
      fitness,
      injury_status,
      injured_at,
      yellow_cards,
      red_cards,
      suspended,
      last_played_at,
      last_run_key,
      updated_at
    ) values (
      world_key,
      incoming_player_id,
      season_key,
      incoming_fitness,
      incoming_injury,
      case when incoming_injury is null then null else played_timestamp end,
      incoming_yellows,
      incoming_reds,
      incoming_sent_off,
      played_timestamp,
      run_key,
      now()
    )
    on conflict (world_id, player_id) do update
    set
      season_id = excluded.season_id,
      fitness = excluded.fitness,
      injury_status = case
        when public.player_match_state.season_id is distinct from excluded.season_id then excluded.injury_status
        else coalesce(excluded.injury_status, public.player_match_state.injury_status)
      end,
      injured_at = case
        when excluded.injury_status is not null then excluded.injured_at
        when public.player_match_state.season_id is distinct from excluded.season_id then null
        else public.player_match_state.injured_at
      end,
      yellow_cards = case
        when public.player_match_state.season_id is distinct from excluded.season_id then excluded.yellow_cards
        else public.player_match_state.yellow_cards + excluded.yellow_cards
      end,
      red_cards = case
        when public.player_match_state.season_id is distinct from excluded.season_id then excluded.red_cards
        else public.player_match_state.red_cards + excluded.red_cards
      end,
      suspended = case
        when public.player_match_state.season_id is distinct from excluded.season_id then excluded.suspended
        else public.player_match_state.suspended or excluded.suspended
      end,
      last_played_at = excluded.last_played_at,
      last_run_key = excluded.last_run_key,
      updated_at = now();
  end loop;

  return true;
end;
$$;

revoke all on function public.apply_match_state_changes(text, text, text, text, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.apply_match_state_changes(text, text, text, text, timestamptz, jsonb) to service_role;

commit;
