begin;

create or replace function public.finalise_match_with_state(
  fixture_key text,
  home_goals integer,
  away_goals integer,
  result_json jsonb,
  played_timestamp timestamptz default now(),
  state_run_key text default null,
  state_changes_json jsonb default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  target_fixture public.fixtures%rowtype;
  state_applied boolean := false;
begin
  select * into target_fixture
  from public.fixtures
  where id = fixture_key
  for update;

  if not found then
    raise exception 'Fixture % does not exist', fixture_key;
  end if;

  -- A committed response may be lost in transit. Treat an identical retry as a
  -- successful no-op, but reject an attempt to overwrite an official result.
  if target_fixture.status = 'played' then
    if target_fixture.home_score is distinct from home_goals
      or target_fixture.away_score is distinct from away_goals then
      raise exception 'Fixture % is already finalised with a different score', fixture_key;
    end if;
    return false;
  end if;

  if state_run_key is not null or state_changes_json is not null then
    if coalesce(state_run_key, '') = '' then
      raise exception 'state_run_key is required when state changes are supplied';
    end if;
    if state_changes_json is null then
      raise exception 'state_changes_json is required when state_run_key is supplied';
    end if;

    state_applied := public.apply_match_state_changes(
      state_run_key,
      fixture_key,
      target_fixture.world_id,
      target_fixture.season_id,
      played_timestamp,
      state_changes_json
    );
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

  return state_applied;
end;
$$;

revoke all on function public.finalise_match_with_state(text, integer, integer, jsonb, timestamptz, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.finalise_match_with_state(text, integer, integer, jsonb, timestamptz, text, jsonb)
  to service_role;

commit;
