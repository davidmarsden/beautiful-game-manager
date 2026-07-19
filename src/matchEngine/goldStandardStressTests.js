import { resolveTeamQuality } from './modules/PlayerQuality.js';
import { resolvePlayerContext, resolveTeamContext, FATIGUE_DIALS } from './modules/FatigueContext.js';

const round = (value, places = 4) => Number(Number(value).toFixed(places));
const average = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

export const GOLD_STANDARD_HARNESS_VERSION = 'tbg-gold-standard-harness-v1.0';

function playerRow(row) {
  return {
    tbg_player_id: row.id,
    display_name: row.id,
    position: row.position,
    underlying_ability_rating: row.ability,
    work_rate: row.work_rate ?? 60
  };
}

function squadPlayers(squad) {
  return squad.players.map(playerRow);
}

function playersById(squad) {
  return new Map(squadPlayers(squad).map((player) => [player.tbg_player_id, player]));
}

function validateSelection(squad, startingXi, bench) {
  const squadIds = new Set(squad.players.map((row) => row.id));
  const uniqueXi = new Set(startingXi);
  const uniqueBench = new Set(bench);
  if (startingXi.length !== 11 || uniqueXi.size !== 11) throw new Error('Gold-standard starting XI must contain 11 unique players');
  for (const playerId of [...startingXi, ...bench]) {
    if (!squadIds.has(playerId)) throw new Error(`Gold-standard selected player not found in squad: ${playerId}`);
  }
  for (const playerId of uniqueXi) {
    if (uniqueBench.has(playerId)) throw new Error(`Gold-standard player selected in both starting XI and bench: ${playerId}`);
  }
}

export function teamFromSetup(squad, setupKey, overrides = {}) {
  const setup = squad.setups[setupKey];
  if (!setup) throw new Error(`Gold-standard setup not found: ${setupKey}`);
  const startingXi = [...(overrides.starting_xi || setup.starting_xi)];
  const bench = squad.players.map((row) => row.id).filter((id) => !startingXi.includes(id));
  validateSelection(squad, startingXi, bench);
  return {
    side: overrides.side || 'home',
    club_id: squad.club_id,
    club_name: squad.club_id,
    formation: setup.formation,
    starting_xi: startingXi,
    bench,
    previous_starting_xi: overrides.previous_starting_xi,
    cohesion: overrides.cohesion ?? 75,
    tactical_familiarity: overrides.tactical_familiarity ?? 80,
    tactics: {
      style: setup.style,
      route_to_goal: setup.route_to_goal,
      pressing: setup.pressing,
      tempo: setup.tempo,
      mentality: 'balanced'
    }
  };
}

function quality(squad, setupKey, overrides = {}) {
  return resolveTeamQuality(teamFromSetup(squad, setupKey, overrides), playersById(squad));
}

function stressTest1(dataset) {
  const southall = dataset.squads.southall;
  const northfield = dataset.squads.northfield;
  const southallWide = quality(southall, 'wide_433');
  const southallCentral = quality(southall, 'central_4231');
  const southallWingBack = quality(southall, 'wide_352');
  const southallDirect = quality(southall, 'direct_442');
  const northWide = quality(northfield, 'wide_433');
  const northCentral = quality(northfield, 'central_4231');

  const checks = {
    southall_wide_433_beats_central_4231: southallWide.team_strength > southallCentral.team_strength,
    northfield_central_4231_beats_wide_433: northCentral.team_strength > northWide.team_strength,
    best_setup_diverges_by_squad: southallWide.team_strength > southallCentral.team_strength && northCentral.team_strength > northWide.team_strength,
    no_universal_4231_meta: southallCentral.team_strength < Math.max(southallWide.team_strength, southallWingBack.team_strength, southallDirect.team_strength)
  };

  return {
    id: 'st1',
    name: dataset.stress_tests.st1.name,
    metrics: {
      southall: {
        wide_433: southallWide.team_strength,
        wide_352: southallWingBack.team_strength,
        direct_442: southallDirect.team_strength,
        central_4231: southallCentral.team_strength
      },
      northfield: { wide_433: northWide.team_strength, central_4231: northCentral.team_strength }
    },
    checks,
    accepted: Object.values(checks).every(Boolean)
  };
}

function recovered(current, days) {
  return clamp(current + days * FATIGUE_DIALS.recovery_per_rest_day, 0, 100);
}

function fixtureBlock(squad, fixtureDays, rotate) {
  const map = playersById(squad);
  const base = squad.setups.wide_433.starting_xi;
  const state = Object.fromEntries(squad.players.map((row) => [row.id, 100]));
  const previous = { ids: null, day: fixtureDays[0] };
  const reports = [];

  fixtureDays.forEach((day, index) => {
    const restDays = index === 0 ? 0 : day - previous.day;
    for (const playerId of Object.keys(state)) state[playerId] = recovered(state[playerId], restDays);

    let xi = [...base];
    if (rotate && index % 2 === 1) {
      xi = xi.map((id) => id === 'southall-rb' ? 'southall-fb2' : id === 'southall-lw' ? 'southall-wing2' : id);
    }
    if (rotate && index % 3 === 2) xi = xi.map((id) => id === 'southall-st' ? 'southall-st2' : id);

    const team = teamFromSetup(squad, 'wide_433', {
      starting_xi: xi,
      previous_starting_xi: previous.ids,
      tactical_familiarity: 90,
      cohesion: 80
    });
    const q = resolveTeamQuality(team, map);
    const world = { match_state: { players: Object.fromEntries(Object.entries(state).map(([id, fitness]) => [id, { fitness, sharpness: 100, morale: 50 }])) } };
    const context = resolveTeamContext(team, map, world, { formation: team.formation, style: 'possession', route_to_goal: 'wide' }, q);
    for (const player of context.players) state[player.player_id] = player.projected_post_match_fitness_90;
    reports.push({ day, xi, bench: team.bench, quality: q.team_strength, context });
    previous.ids = xi;
    previous.day = day;
  });

  return {
    reports,
    final_squad_fitness: round(average(Object.values(state)), 3),
    final_identity_unit_fitness: round(average(['southall-rb','southall-lb','southall-rw','southall-lw','southall-st'].map((id) => state[id])), 3),
    average_selected_quality: round(average(reports.map((row) => row.quality)), 3),
    maximum_injury_risk: round(Math.max(...reports.flatMap((row) => row.context.players.map((player) => player.injury_risk_90))), 5)
  };
}

function stressTest2(dataset) {
  const squad = dataset.squads.southall;
  const days = dataset.stress_tests.st2.fixture_days;
  const rigid = fixtureBlock(squad, days, false);
  const rotated = fixtureBlock(squad, days, true);
  const map = playersById(squad);
  const highTeam = teamFromSetup(squad, 'wide_433', { tactical_familiarity: 90, cohesion: 85 });
  const lowTeam = teamFromSetup(squad, 'wide_433', { tactical_familiarity: 20, cohesion: 35 });
  const q = resolveTeamQuality(highTeam, map);
  const high = resolveTeamContext(highTeam, map, {}, { formation: '4-3-3-wide', style: 'possession', route_to_goal: 'wide' }, q);
  const low = resolveTeamContext(lowTeam, map, {}, { formation: '4-3-3-wide', style: 'possession', route_to_goal: 'wide' }, q);

  const checks = {
    rigid_selection_accumulates_more_fatigue: rotated.final_identity_unit_fitness > rigid.final_identity_unit_fitness,
    rotation_preserves_more_squad_fitness: rotated.final_squad_fitness > rigid.final_squad_fitness,
    high_familiarity_reduces_dispersion: high.variance.dispersion_multiplier < low.variance.dispersion_multiplier,
    thin_depth_has_a_real_quality_cost: rotated.average_selected_quality < rigid.average_selected_quality
  };
  return { id: 'st2', name: dataset.stress_tests.st2.name, metrics: { rigid, rotated, high_dispersion: high.variance.dispersion_multiplier, low_dispersion: low.variance.dispersion_multiplier }, checks, accepted: Object.values(checks).every(Boolean) };
}

function stressTest3(dataset) {
  const squad = dataset.squads.southall;
  const map = playersById(squad);
  const firstChoiceTeam = teamFromSetup(squad, 'wide_433', { tactical_familiarity: 90 });
  const rotatedXi = firstChoiceTeam.starting_xi.map((id) => id === 'southall-rb' ? 'southall-fb2' : id === 'southall-lw' ? 'southall-wing2' : id);
  const rotatedTeam = teamFromSetup(squad, 'wide_433', { starting_xi: rotatedXi, tactical_familiarity: 90, previous_starting_xi: firstChoiceTeam.starting_xi });
  const firstQuality = resolveTeamQuality(firstChoiceTeam, map);
  const rotatedQuality = resolveTeamQuality(rotatedTeam, map);
  const firstContext = resolveTeamContext(firstChoiceTeam, map, {}, { formation: '4-3-3-wide', style: 'possession', route_to_goal: 'wide' }, firstQuality);
  const rotatedContext = resolveTeamContext(rotatedTeam, map, {}, { formation: '4-3-3-wide', style: 'possession', route_to_goal: 'wide' }, rotatedQuality);
  const fullBack = resolvePlayerContext(map.get('southall-rb'), firstChoiceTeam, 'fb', {});
  const wingBack = resolvePlayerContext(map.get('southall-rb'), { ...firstChoiceTeam, formation: '3-5-2' }, 'wing_back', {});
  const days = dataset.stress_tests.st2.fixture_days;
  const rigid = fixtureBlock(squad, days, false);
  const managed = fixtureBlock(squad, days, true);

  const checks = {
    wide_identity_survives_rotation: rotatedContext.tactical_package === firstContext.tactical_package,
    rotated_identity_loses_mean_quality_not_familiarity: rotatedQuality.team_strength < firstQuality.team_strength && rotatedContext.familiarity.score === firstContext.familiarity.score,
    wing_backs_have_higher_workload_than_full_backs: wingBack.workload_multiplier > fullBack.workload_multiplier,
    managed_identity_beats_rigid_burnout_on_availability: managed.final_identity_unit_fitness > rigid.final_identity_unit_fitness
  };
  return {
    id: 'st3', name: dataset.stress_tests.st3.name,
    metrics: {
      first_choice_quality: firstQuality.team_strength,
      rotated_quality: rotatedQuality.team_strength,
      first_choice_familiarity: firstContext.familiarity.score,
      rotated_familiarity: rotatedContext.familiarity.score,
      full_back_workload: fullBack.workload_multiplier,
      wing_back_workload: wingBack.workload_multiplier,
      rigid_identity_fitness: rigid.final_identity_unit_fitness,
      managed_identity_fitness: managed.final_identity_unit_fitness
    },
    checks,
    accepted: Object.values(checks).every(Boolean)
  };
}

export function runGoldStandardStressTests(dataset) {
  if (!dataset || dataset.dataset_version !== 'tbg-match-engine-gold-standard-v1.0') throw new Error('Unsupported or missing gold-standard dataset');
  const tests = [stressTest1(dataset), stressTest2(dataset), stressTest3(dataset)];
  return Object.freeze({
    version: GOLD_STANDARD_HARNESS_VERSION,
    dataset_version: dataset.dataset_version,
    tests: Object.freeze(tests),
    accepted: tests.every((row) => row.accepted)
  });
}
