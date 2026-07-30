begin;

create or replace function public.get_manager_portal_world_fragment(
  p_world_id text,
  p_club_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  stored public.canonical_world_saves%rowtype;
  envelope jsonb;
  world jsonb;
  squad_cycle jsonb;
  club jsonb;
  player_ids jsonb;
  players jsonb := '{}'::jsonb;
  contracts jsonb := '{}'::jsonb;
  player_ownership jsonb := '[]'::jsonb;
  division jsonb;
  division_id text;
  runtime jsonb;
  fragment jsonb;
begin
  select * into stored
  from public.canonical_world_saves
  where world_id = p_world_id
  limit 1;

  if not found then
    return null;
  end if;

  envelope := stored.save_envelope;
  if coalesce(envelope ->> 'save_version', '') <> 'tbg-playable-world-save-v1.0' then
    raise exception 'Unsupported canonical save version for world %', p_world_id;
  end if;

  if coalesce(envelope ->> 'checksum', '') = ''
    or stored.save_checksum <> envelope ->> 'checksum' then
    raise exception 'Canonical save checksum metadata mismatch for world %', p_world_id;
  end if;

  world := envelope -> 'world';
  if world is null or jsonb_typeof(world) <> 'object' then
    raise exception 'Canonical save envelope for world % has no valid world payload', p_world_id;
  end if;

  if coalesce(world ->> 'world_id', '') <> p_world_id
    or coalesce(world ->> 'version', '') <> 'tbg-playable-persistent-world-v1.0'
    or jsonb_typeof(world -> 'squad_cycle') <> 'object'
    or coalesce(world -> 'squad_cycle' ->> 'season_id', '') <> stored.season_id then
    raise exception 'Canonical world % failed fragment integrity validation', p_world_id;
  end if;

  squad_cycle := world -> 'squad_cycle';
  club := squad_cycle -> 'clubs' -> p_club_id;

  if club is null then
    raise exception 'Appointment club % is not present in canonical world %', p_club_id, p_world_id;
  end if;

  player_ids := coalesce(club -> 'player_ids', '[]'::jsonb);

  select coalesce(jsonb_object_agg(entry.key, entry.value), '{}'::jsonb)
    into players
  from jsonb_each(coalesce(squad_cycle -> 'players', '{}'::jsonb)) entry
  where entry.key in (select jsonb_array_elements_text(player_ids));

  select coalesce(jsonb_object_agg(entry.key, entry.value), '{}'::jsonb)
    into contracts
  from jsonb_each(coalesce(squad_cycle -> 'contracts', '{}'::jsonb)) entry
  where entry.key in (
    select value ->> 'contract_id'
    from jsonb_each(players)
    where coalesce(value ->> 'contract_id', '') <> ''
  );

  select coalesce(jsonb_agg(entry.value), '[]'::jsonb)
    into player_ownership
  from jsonb_array_elements(coalesce(squad_cycle -> 'player_ownership', world -> 'player_ownership', '[]'::jsonb)) entry(value)
  where coalesce(entry.value ->> 'tbg_player_id', entry.value ->> 'player_id', entry.value ->> 'id')
    in (select jsonb_array_elements_text(player_ids));

  select value into division
  from jsonb_array_elements(coalesce(world -> 'competition' -> 'divisions', '[]'::jsonb)) value
  where coalesce(value -> 'club_ids', '[]'::jsonb) ? p_club_id
  limit 1;

  division_id := division ->> 'division_id';
  runtime := case
    when division_id is null then null
    else world -> 'matchday_cycle' -> 'runtimes' -> division_id
  end;

  fragment := jsonb_build_object(
    'version', world -> 'version',
    'world_id', world -> 'world_id',
    'display_name', world -> 'display_name',
    'phase', world -> 'phase',
    'clock', world -> 'clock',
    'season_number', world -> 'season_number',
    'rules', coalesce(world -> 'rules', '{}'::jsonb),
    'loan_rules', coalesce(world -> 'loan_rules', '{}'::jsonb),
    'competition_rules', coalesce(world -> 'competition_rules', '{}'::jsonb),
    'club_profiles', coalesce(world -> 'club_profiles', '{}'::jsonb),
    'competition', jsonb_build_object(
      'divisions', case when division is null then '[]'::jsonb else jsonb_build_array(division) end,
      'competitions', coalesce(world -> 'competition' -> 'competitions', '[]'::jsonb)
    ),
    'squad_cycle', jsonb_build_object(
      'season_id', squad_cycle -> 'season_id',
      'registration_limit', squad_cycle -> 'registration_limit',
      'clubs', jsonb_build_object(p_club_id, club),
      'players', players,
      'contracts', contracts,
      'player_ownership', player_ownership,
      'state', jsonb_build_object(
        'registrations', coalesce(squad_cycle -> 'state' -> 'registrations', '{}'::jsonb)
      )
    ),
    'matchday_cycle', jsonb_build_object(
      'current_matchday', world -> 'matchday_cycle' -> 'current_matchday',
      'maximum_matchday', world -> 'matchday_cycle' -> 'maximum_matchday',
      'turn_calendar', coalesce(world -> 'matchday_cycle' -> 'turn_calendar', '{}'::jsonb),
      'runtimes', case when division_id is null or runtime is null then '{}'::jsonb else jsonb_build_object(division_id, runtime) end
    ),
    'player_ownership', player_ownership
  );

  return jsonb_build_object(
    'world_id', stored.world_id,
    'save_checksum', stored.save_checksum,
    'season_id', stored.season_id,
    'season_number', stored.season_number,
    'phase', stored.phase,
    'matchday', stored.matchday,
    'next_turn_at', stored.next_turn_at,
    'turn_status', stored.turn_status,
    'created_at', stored.created_at,
    'updated_at', stored.updated_at,
    'world', fragment
  );
end;
$$;

revoke all on function public.get_manager_portal_world_fragment(text, text) from public;
grant execute on function public.get_manager_portal_world_fragment(text, text) to service_role;

commit;
