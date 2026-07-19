import { simulateMatch, MATCH_ENGINE_MODES } from '../matchSimulation.js';

const round = (value, places = 4) => Number(Number(value).toFixed(places));
const POSITIONS = Object.freeze([
  'Goalkeeper', 'Right-Back', 'Centre-Back', 'Centre-Back', 'Left-Back',
  'Defensive Midfield', 'Central Midfield', 'Central Midfield',
  'Right Winger', 'Centre-Forward', 'Left Winger'
]);

export const SHADOW_COMPARISON_VERSION = 'tbg-shadow-comparison-v1.1';
export const SHADOW_ACCEPTANCE = Object.freeze({
  average_total_goals_delta_maximum: 0.75,
  draw_rate_delta_maximum: 0.12,
  home_win_rate_delta_maximum: 0.15,
  stronger_team_non_loss_rate_delta_maximum: 0.15,
  average_absolute_goal_delta_maximum: 1.75,
  public_contract_compatible: true
});

const SCENARIOS = Object.freeze([
  { id: 'equal-91', home: 91, away: 91, mentality: 'balanced', pressing: 'mid', tempo: 'normal' },
  { id: 'home-plus-4', home: 95, away: 91, mentality: 'balanced', pressing: 'mid', tempo: 'normal' },
  { id: 'away-plus-4', home: 91, away: 95, mentality: 'balanced', pressing: 'mid', tempo: 'normal' },
  { id: 'home-plus-10', home: 95, away: 85, mentality: 'balanced', pressing: 'mid', tempo: 'normal' },
  { id: 'away-plus-10', home: 85, away: 95, mentality: 'balanced', pressing: 'mid', tempo: 'normal' },
  { id: 'equal-attacking', home: 91, away: 91, mentality: 'attacking', pressing: 'high', tempo: 'fast' },
  { id: 'equal-cautious', home: 91, away: 91, mentality: 'cautious', pressing: 'low', tempo: 'slow' }
]);

function playerRows(prefix, rating) {
  return POSITIONS.map((position, index) => ({
    tbg_player_id: `${prefix}-${index + 1}`,
    display_name: `${prefix}-${index + 1}`,
    position,
    underlying_ability_rating: rating,
    work_rate: 60
  }));
}

function team(side, prefix, scenario) {
  return {
    side,
    club_id: prefix,
    club_name: prefix,
    formation: '4-3-3-wide',
    starting_xi: POSITIONS.map((_, index) => `${prefix}-${index + 1}`),
    bench: [],
    tactics: {
      style: 'balanced', route_to_goal: 'balanced', pressing: scenario.pressing,
      tempo: scenario.tempo, mentality: scenario.mentality
    }
  };
}

function fixture(scenario, index) {
  const homePrefix = `shadow-${scenario.id}-${index}-home`;
  const awayPrefix = `shadow-${scenario.id}-${index}-away`;
  const base = {
    contract_version: '2d2-v1',
    run_key: `shadow:${scenario.id}:${index}`,
    fixture: {
      fixture_id: `shadow-${scenario.id}-${index}`,
      season_id: 'shadow-comparison',
      matchday: index + 1,
      kickoff_at: '2026-07-19T15:00:00.000Z'
    },
    teams: {
      home: team('home', homePrefix, scenario),
      away: team('away', awayPrefix, scenario)
    }
  };
  return {
    contract: base,
    world: { players: [...playerRows(homePrefix, scenario.home), ...playerRows(awayPrefix, scenario.away)] }
  };
}

function outcome(result) {
  if (result.score.home > result.score.away) return 'home_win';
  if (result.score.away > result.score.home) return 'away_win';
  return 'draw';
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validatePublicEvent(event, index, require) {
  const prefix = `events[${index}]`;
  require(event && typeof event === 'object' && !Array.isArray(event), `${prefix} must be an object`);
  if (!event || typeof event !== 'object' || Array.isArray(event)) return;

  require(nonEmptyString(event.event_id), `${prefix}.event_id must be a non-empty string`);
  require(nonEmptyString(event.type), `${prefix}.type must be a non-empty string`);
  require(Number.isInteger(event.minute) && event.minute >= 0 && event.minute <= 120, `${prefix}.minute must be an integer from 0 to 120`);
  require(['home', 'away', 'neutral'].includes(event.side), `${prefix}.side must use the public enum`);
  require(nonEmptyString(event.commentary), `${prefix}.commentary must be a non-empty string`);

  for (const field of ['source_event_id', 'parent_event_id', 'linked_event_id']) {
    require(event[field] == null || nonEmptyString(event[field]), `${prefix}.${field} must be null or a non-empty string`);
  }
}

function publicContract(result) {
  const errors = [];
  const require = (condition, message) => { if (!condition) errors.push(message); };
  require(result?.result_version === '2d5-v1', 'result_version must be 2d5-v1');
  require(nonEmptyString(result?.run_key), 'run_key must be a non-empty string');
  require(nonEmptyString(result?.fixture_id), 'fixture_id must be a non-empty string');
  require(result?.status === 'completed', 'status must be completed');
  require(Number.isInteger(result?.score?.home) && result.score.home >= 0, 'score.home must be a non-negative integer');
  require(Number.isInteger(result?.score?.away) && result.score.away >= 0, 'score.away must be a non-negative integer');
  require(['home_win', 'away_win', 'draw'].includes(result?.outcome), 'outcome must use the public enum');
  require(Array.isArray(result?.events), 'events must be an array');
  if (Array.isArray(result?.events)) {
    result.events.forEach((event, index) => validatePublicEvent(event, index, require));
  }
  for (const side of ['home', 'away']) {
    require(Number.isFinite(result?.statistics?.[side]?.shots), `statistics.${side}.shots must be numeric`);
    require(Number.isFinite(result?.statistics?.[side]?.shots_on_target), `statistics.${side}.shots_on_target must be numeric`);
    require(Number.isFinite(result?.statistics?.[side]?.possession), `statistics.${side}.possession must be numeric`);
  }
  require(result?.model && typeof result.model === 'object', 'model must be an object');
  return Object.freeze({ compatible: errors.length === 0, errors: Object.freeze(errors) });
}

function emptyAggregate() {
  return { matches: 0, goals: 0, home_wins: 0, away_wins: 0, draws: 0, stronger_non_losses: 0, stronger_matches: 0 };
}

function addResult(row, result, scenario) {
  row.matches += 1;
  row.goals += result.score.home + result.score.away;
  row[`${outcome(result)}s`] += 1;
  if (scenario.home !== scenario.away) {
    row.stronger_matches += 1;
    const strongerIsHome = scenario.home > scenario.away;
    const strongerLost = strongerIsHome ? result.score.home < result.score.away : result.score.away < result.score.home;
    if (!strongerLost) row.stronger_non_losses += 1;
  }
}

function aggregateReport(row) {
  return Object.freeze({
    matches: row.matches,
    average_total_goals: round(row.goals / row.matches, 3),
    home_win_rate: round(row.home_wins / row.matches),
    away_win_rate: round(row.away_wins / row.matches),
    draw_rate: round(row.draws / row.matches),
    stronger_team_non_loss_rate: row.stronger_matches ? round(row.stronger_non_losses / row.stronger_matches) : null
  });
}

export function runShadowComparison({ matchesPerScenario = 200, simulator = simulateMatch } = {}) {
  if (!Number.isInteger(matchesPerScenario) || matchesPerScenario < 80) {
    throw new Error('Shadow comparison requires at least 80 integer matches per scenario');
  }

  const compatibility = emptyAggregate();
  const constitutional = emptyAggregate();
  const contractErrors = { compatibility: [], constitutional: [] };
  const scenarioRows = [];
  let absoluteGoalDelta = 0;
  let exactScoreMatches = 0;
  let outcomeMatches = 0;

  for (const scenario of SCENARIOS) {
    const legacyRow = emptyAggregate();
    const constitutionalRow = emptyAggregate();
    for (let index = 0; index < matchesPerScenario; index += 1) {
      const { contract, world } = fixture(scenario, index);
      const legacy = simulator({ ...contract, engine_mode: MATCH_ENGINE_MODES.compatibility }, world);
      const next = simulator({ ...contract, engine_mode: MATCH_ENGINE_MODES.constitutional }, world);
      addResult(compatibility, legacy, scenario);
      addResult(constitutional, next, scenario);
      addResult(legacyRow, legacy, scenario);
      addResult(constitutionalRow, next, scenario);
      absoluteGoalDelta += Math.abs(legacy.score.home - next.score.home) + Math.abs(legacy.score.away - next.score.away);
      if (legacy.score.home === next.score.home && legacy.score.away === next.score.away) exactScoreMatches += 1;
      if (outcome(legacy) === outcome(next)) outcomeMatches += 1;
      for (const [mode, result] of [['compatibility', legacy], ['constitutional', next]]) {
        const contractCheck = publicContract(result);
        if (!contractCheck.compatible) contractErrors[mode].push({ scenario: scenario.id, index, errors: contractCheck.errors });
      }
    }
    scenarioRows.push(Object.freeze({
      scenario_id: scenario.id,
      home_rating: scenario.home,
      away_rating: scenario.away,
      compatibility: aggregateReport(legacyRow),
      constitutional: aggregateReport(constitutionalRow)
    }));
  }

  const legacy = aggregateReport(compatibility);
  const next = aggregateReport(constitutional);
  const totalMatches = matchesPerScenario * SCENARIOS.length;
  const deltas = Object.freeze({
    average_total_goals: round(next.average_total_goals - legacy.average_total_goals, 3),
    draw_rate: round(next.draw_rate - legacy.draw_rate),
    home_win_rate: round(next.home_win_rate - legacy.home_win_rate),
    stronger_team_non_loss_rate: round(next.stronger_team_non_loss_rate - legacy.stronger_team_non_loss_rate),
    average_absolute_goal_delta: round(absoluteGoalDelta / (totalMatches * 2), 3),
    exact_score_match_rate: round(exactScoreMatches / totalMatches),
    outcome_match_rate: round(outcomeMatches / totalMatches)
  });
  const publicContractCompatible = contractErrors.compatibility.length === 0 && contractErrors.constitutional.length === 0;
  const checks = Object.freeze({
    average_total_goals_within_tolerance: Math.abs(deltas.average_total_goals) <= SHADOW_ACCEPTANCE.average_total_goals_delta_maximum,
    draw_rate_within_tolerance: Math.abs(deltas.draw_rate) <= SHADOW_ACCEPTANCE.draw_rate_delta_maximum,
    home_win_rate_within_tolerance: Math.abs(deltas.home_win_rate) <= SHADOW_ACCEPTANCE.home_win_rate_delta_maximum,
    stronger_non_loss_rate_within_tolerance: Math.abs(deltas.stronger_team_non_loss_rate) <= SHADOW_ACCEPTANCE.stronger_team_non_loss_rate_delta_maximum,
    goal_difference_within_tolerance: deltas.average_absolute_goal_delta <= SHADOW_ACCEPTANCE.average_absolute_goal_delta_maximum,
    public_contract_compatible: publicContractCompatible
  });
  const accepted = Object.values(checks).every(Boolean);

  return Object.freeze({
    version: SHADOW_COMPARISON_VERSION,
    generated_from_common_fixtures: true,
    matches_per_scenario: matchesPerScenario,
    total_matches: totalMatches,
    scenarios: Object.freeze(scenarioRows),
    aggregate: Object.freeze({ compatibility: legacy, constitutional: next, deltas }),
    public_contract: Object.freeze({ compatible: publicContractCompatible, errors: Object.freeze(contractErrors) }),
    thresholds: SHADOW_ACCEPTANCE,
    checks,
    accepted,
    recommendation: accepted ? 'ready_for_default_cutover_review' : 'hold_for_shadow_review'
  });
}
