import { simulateMatch, MATCH_ENGINE_MODES } from '../matchSimulation.js';

const round = (value, places = 4) => Number(Number(value).toFixed(places));
const inRange = (value, minimum, maximum) => value >= minimum && value <= maximum;

export const FINAL_OUTCOME_CALIBRATION_VERSION = 'tbg-final-outcome-calibration-v1.0';

export const FINAL_OUTCOME_THRESHOLDS = Object.freeze({
  average_goals_per_match: Object.freeze({ minimum: 1.8, maximum: 3.2 }),
  equal_team_draw_rate: Object.freeze({ minimum: 0.18, maximum: 0.38 }),
  equal_team_home_win_rate: Object.freeze({ minimum: 0.32, maximum: 0.48 }),
  home_win_advantage: Object.freeze({ minimum: -0.02, maximum: 0.12 }),
  rating_gaps: Object.freeze({
    2: Object.freeze({ stronger_non_loss_minimum: 0.57, upset_minimum: 0.20, upset_maximum: 0.43 }),
    4: Object.freeze({ stronger_non_loss_minimum: 0.62, upset_minimum: 0.16, upset_maximum: 0.38 }),
    10: Object.freeze({ stronger_non_loss_minimum: 0.66, upset_minimum: 0.08, upset_maximum: 0.34 })
  }),
  maximum_non_loss_regression_between_gaps: 0.03,
  maximum_upset_increase_between_gaps: 0.03
});

const POSITIONS = Object.freeze([
  'Goalkeeper', 'Right-Back', 'Centre-Back', 'Centre-Back', 'Left-Back',
  'Defensive Midfield', 'Central Midfield', 'Central Midfield',
  'Right Winger', 'Centre-Forward', 'Left Winger'
]);

function players(prefix, rating) {
  return POSITIONS.map((position, index) => ({
    tbg_player_id: `${prefix}-${index + 1}`,
    display_name: `${prefix}-${index + 1}`,
    position,
    underlying_ability_rating: rating,
    work_rate: 60
  }));
}

function team(side, prefix) {
  return {
    side,
    club_id: prefix,
    club_name: prefix,
    formation: '4-3-3-wide',
    starting_xi: POSITIONS.map((_, index) => `${prefix}-${index + 1}`),
    bench: [],
    tactics: {
      style: 'balanced', route_to_goal: 'balanced', pressing: 'mid',
      tempo: 'normal', mentality: 'balanced'
    }
  };
}

function simulateScenario({ scenarioId, strongerRating, weakerRating, matches, simulator }) {
  let strongerWins = 0;
  let draws = 0;
  let upsets = 0;
  let homeWins = 0;
  let awayWins = 0;
  let totalGoals = 0;
  let strongerHomeWins = 0;
  let strongerAwayWins = 0;

  for (let index = 0; index < matches; index += 1) {
    const equal = strongerRating === weakerRating;
    const strongerSide = equal ? null : index % 2 === 0 ? 'home' : 'away';
    const homeRating = strongerSide === 'away' ? weakerRating : strongerRating;
    const awayRating = strongerSide === 'home' ? weakerRating : strongerRating;
    const homePrefix = `${scenarioId}-${index}-home`;
    const awayPrefix = `${scenarioId}-${index}-away`;
    const contract = {
      contract_version: '2d2-v1',
      engine_mode: MATCH_ENGINE_MODES.constitutional,
      rating_band_calibration: true,
      validation_gap: strongerRating - weakerRating,
      validation_scenario: scenarioId,
      run_key: `final-calibration:${scenarioId}:${index}`,
      fixture: {
        fixture_id: `final-calibration-${scenarioId}-${index}`,
        season_id: 'final-outcome-calibration',
        matchday: index + 1,
        kickoff_at: '2026-08-01T15:00:00.000Z'
      },
      teams: { home: team('home', homePrefix), away: team('away', awayPrefix) }
    };
    const result = simulator(contract, { players: [...players(homePrefix, homeRating), ...players(awayPrefix, awayRating)] });
    const homeGoals = Number(result.score.home);
    const awayGoals = Number(result.score.away);
    totalGoals += homeGoals + awayGoals;
    if (homeGoals > awayGoals) homeWins += 1;
    else if (awayGoals > homeGoals) awayWins += 1;
    else draws += 1;

    if (!equal) {
      const strongerGoals = strongerSide === 'home' ? homeGoals : awayGoals;
      const weakerGoals = strongerSide === 'home' ? awayGoals : homeGoals;
      if (strongerGoals > weakerGoals) {
        strongerWins += 1;
        if (strongerSide === 'home') strongerHomeWins += 1;
        else strongerAwayWins += 1;
      } else if (strongerGoals < weakerGoals) upsets += 1;
    }
  }

  return Object.freeze({
    scenario_id: scenarioId,
    rating_gap: strongerRating - weakerRating,
    stronger_rating: strongerRating,
    weaker_rating: weakerRating,
    matches,
    average_goals_per_match: round(totalGoals / matches, 3),
    home_win_rate: round(homeWins / matches),
    away_win_rate: round(awayWins / matches),
    draw_rate: round(draws / matches),
    home_win_advantage: round((homeWins - awayWins) / matches),
    stronger_win_rate: strongerRating === weakerRating ? null : round(strongerWins / matches),
    stronger_non_loss_rate: strongerRating === weakerRating ? null : round((strongerWins + draws) / matches),
    upset_rate: strongerRating === weakerRating ? null : round(upsets / matches),
    stronger_home_win_rate: strongerRating === weakerRating ? null : round(strongerHomeWins / (matches / 2)),
    stronger_away_win_rate: strongerRating === weakerRating ? null : round(strongerAwayWins / (matches / 2))
  });
}

export function runFinalOutcomeCalibration({ matchesPerScenario = 1000, simulator = simulateMatch, thresholds = FINAL_OUTCOME_THRESHOLDS } = {}) {
  if (!Number.isInteger(matchesPerScenario) || matchesPerScenario < 200 || matchesPerScenario % 2 !== 0) {
    throw new Error('Final outcome calibration requires an even sample of at least 200 matches per scenario');
  }

  const scenarios = Object.freeze([
    simulateScenario({ scenarioId: 'equal-91', strongerRating: 91, weakerRating: 91, matches: matchesPerScenario, simulator }),
    simulateScenario({ scenarioId: 'gap-2', strongerRating: 91, weakerRating: 89, matches: matchesPerScenario, simulator }),
    simulateScenario({ scenarioId: 'gap-4', strongerRating: 95, weakerRating: 91, matches: matchesPerScenario, simulator }),
    simulateScenario({ scenarioId: 'gap-10', strongerRating: 95, weakerRating: 85, matches: matchesPerScenario, simulator })
  ]);
  const byGap = Object.fromEntries(scenarios.map((scenario) => [scenario.rating_gap, scenario]));
  const equal = byGap[0];
  const ladder = [byGap[2], byGap[4], byGap[10]];
  const gapChecks = Object.fromEntries(ladder.map((scenario) => {
    const target = thresholds.rating_gaps[scenario.rating_gap];
    return [`gap_${scenario.rating_gap}_within_frequency_bands`,
      scenario.stronger_non_loss_rate >= target.stronger_non_loss_minimum
      && inRange(scenario.upset_rate, target.upset_minimum, target.upset_maximum)];
  }));
  const checks = Object.freeze({
    every_scenario_has_realistic_scoring: scenarios.every((scenario) => inRange(
      scenario.average_goals_per_match,
      thresholds.average_goals_per_match.minimum,
      thresholds.average_goals_per_match.maximum
    )),
    equal_team_draw_rate_within_band: inRange(equal.draw_rate, thresholds.equal_team_draw_rate.minimum, thresholds.equal_team_draw_rate.maximum),
    equal_team_home_win_rate_within_band: inRange(equal.home_win_rate, thresholds.equal_team_home_win_rate.minimum, thresholds.equal_team_home_win_rate.maximum),
    home_advantage_is_bounded: inRange(equal.home_win_advantage, thresholds.home_win_advantage.minimum, thresholds.home_win_advantage.maximum),
    ...gapChecks,
    stronger_non_loss_rises_with_rating_gap: ladder.slice(1).every((scenario, index) => (
      scenario.stronger_non_loss_rate + thresholds.maximum_non_loss_regression_between_gaps >= ladder[index].stronger_non_loss_rate
    )),
    upset_frequency_falls_with_rating_gap: ladder.slice(1).every((scenario, index) => (
      scenario.upset_rate <= ladder[index].upset_rate + thresholds.maximum_upset_increase_between_gaps
    )),
    no_rating_gap_makes_results_certain: ladder.every((scenario) => scenario.upset_rate > 0 && scenario.stronger_win_rate < 0.9),
    mirrored_home_away_samples_are_balanced: ladder.every((scenario) => scenario.matches % 2 === 0)
  });

  return Object.freeze({
    version: FINAL_OUTCOME_CALIBRATION_VERSION,
    matches_per_scenario: matchesPerScenario,
    total_matches: matchesPerScenario * scenarios.length,
    thresholds,
    scenarios,
    rating_gap_ladder: Object.freeze(ladder),
    checks,
    accepted: Object.values(checks).every(Boolean)
  });
}
