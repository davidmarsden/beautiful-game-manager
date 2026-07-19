import { simulateMatch, MATCH_ENGINE_MODES } from '../matchSimulation.js';

const round = (value, places = 4) => Number(Number(value).toFixed(places));

export const RATING_BAND_VALIDATION_VERSION = 'tbg-rating-band-validation-v1.0';

export const TBG_RATING_BANDS = Object.freeze({
  d1_elite: Object.freeze({ rating: 95, description: 'D1 elite-tail side' }),
  d1_standard: Object.freeze({ rating: 91, description: 'Typical D1 starting level' }),
  d2_standard: Object.freeze({ rating: 89, description: 'Typical D2 starting level' }),
  lower_division_floor: Object.freeze({ rating: 85, description: 'Lower-division senior floor' }),
  youth_19_21: Object.freeze({ rating: 76, description: 'Established 19–21 youth player' }),
  youth_15_18: Object.freeze({ rating: 68, description: 'Newly discovered 15–18 youth player' })
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

function strongerOutcome(score, strongerSide) {
  const stronger = strongerSide === 'home' ? score.home : score.away;
  const weaker = strongerSide === 'home' ? score.away : score.home;
  return stronger > weaker ? 'win' : stronger === weaker ? 'draw' : 'loss';
}

export function validateRatingPair({
  strongerBand,
  weakerBand,
  matches = 240,
  simulator = simulateMatch,
  scenarioId = `${strongerBand}-vs-${weakerBand}`
}) {
  if (!TBG_RATING_BANDS[strongerBand] || !TBG_RATING_BANDS[weakerBand]) throw new Error(`Unknown rating-band scenario: ${scenarioId}`);
  if (matches < 80 || matches % 2 !== 0) throw new Error('Rating-band validation requires an even sample of at least 80 matches');
  const strongerRating = TBG_RATING_BANDS[strongerBand].rating;
  const weakerRating = TBG_RATING_BANDS[weakerBand].rating;
  if (strongerRating <= weakerRating) throw new Error(`Stronger rating band must exceed weaker band: ${scenarioId}`);

  const outcomes = [];
  let strongerGoals = 0;
  let weakerGoals = 0;
  for (let index = 0; index < matches; index += 1) {
    const strongerSide = index % 2 === 0 ? 'home' : 'away';
    const homeRating = strongerSide === 'home' ? strongerRating : weakerRating;
    const awayRating = strongerSide === 'away' ? strongerRating : weakerRating;
    const homePrefix = `${scenarioId}-${index}-home`;
    const awayPrefix = `${scenarioId}-${index}-away`;
    const contract = {
      contract_version: '2d2-v1',
      engine_mode: MATCH_ENGINE_MODES.constitutional,
      run_key: `rating-band:${scenarioId}:${index}`,
      fixture: {
        fixture_id: `rating-band-${scenarioId}-${index}`,
        season_id: 'rating-band-validation',
        matchday: index + 1,
        kickoff_at: '2026-07-19T15:00:00.000Z'
      },
      teams: { home: team('home', homePrefix), away: team('away', awayPrefix) }
    };
    const world = { players: [...players(homePrefix, homeRating), ...players(awayPrefix, awayRating)] };
    const result = simulator(contract, world);
    outcomes.push(strongerOutcome(result.score, strongerSide));
    strongerGoals += strongerSide === 'home' ? result.score.home : result.score.away;
    weakerGoals += strongerSide === 'home' ? result.score.away : result.score.home;
  }

  const wins = outcomes.filter((outcome) => outcome === 'win').length;
  const draws = outcomes.filter((outcome) => outcome === 'draw').length;
  const losses = outcomes.filter((outcome) => outcome === 'loss').length;
  return Object.freeze({
    scenario_id: scenarioId,
    stronger_band: strongerBand,
    weaker_band: weakerBand,
    rating_gap: strongerRating - weakerRating,
    sample_size: matches,
    stronger_win_rate: round(wins / matches),
    draw_rate: round(draws / matches),
    upset_rate: round(losses / matches),
    stronger_non_loss_rate: round((wins + draws) / matches),
    stronger_goals_per_match: round(strongerGoals / matches, 3),
    weaker_goals_per_match: round(weakerGoals / matches, 3),
    goal_difference_per_match: round((strongerGoals - weakerGoals) / matches, 3)
  });
}

export function runRatingBandValidation({ matchesPerPair = 240, simulator = simulateMatch } = {}) {
  const scenarios = Object.freeze([
    validateRatingPair({ strongerBand: 'd1_standard', weakerBand: 'd2_standard', matches: matchesPerPair, simulator, scenarioId: 'd1-standard-v-d2-standard' }),
    validateRatingPair({ strongerBand: 'd1_elite', weakerBand: 'd1_standard', matches: matchesPerPair, simulator, scenarioId: 'd1-elite-v-d1-standard' }),
    validateRatingPair({ strongerBand: 'd2_standard', weakerBand: 'lower_division_floor', matches: matchesPerPair, simulator, scenarioId: 'd2-standard-v-lower-floor' }),
    validateRatingPair({ strongerBand: 'youth_19_21', weakerBand: 'youth_15_18', matches: matchesPerPair, simulator, scenarioId: 'older-youth-v-new-youth' }),
    validateRatingPair({ strongerBand: 'd1_elite', weakerBand: 'lower_division_floor', matches: matchesPerPair, simulator, scenarioId: 'd1-elite-v-lower-floor' })
  ]);
  const byId = Object.fromEntries(scenarios.map((row) => [row.scenario_id, row]));
  const seniorByGap = scenarios
    .filter((row) => !row.scenario_id.includes('youth'))
    .sort((left, right) => left.rating_gap - right.rating_gap);
  const checks = Object.freeze({
    agreed_band_order_is_preserved:
      TBG_RATING_BANDS.d1_elite.rating > TBG_RATING_BANDS.d1_standard.rating
      && TBG_RATING_BANDS.d1_standard.rating > TBG_RATING_BANDS.d2_standard.rating
      && TBG_RATING_BANDS.d2_standard.rating > TBG_RATING_BANDS.lower_division_floor.rating,
    youth_progression_is_preserved: TBG_RATING_BANDS.youth_19_21.rating > TBG_RATING_BANDS.youth_15_18.rating,
    every_stronger_band_has_positive_goal_edge: scenarios.every((row) => row.goal_difference_per_match > 0),
    every_stronger_band_wins_more_than_it_loses: scenarios.every((row) => row.stronger_win_rate > row.upset_rate),
    senior_non_loss_rate_rises_with_gap: seniorByGap.slice(1).every((row, index) => row.stronger_non_loss_rate + 0.01 >= seniorByGap[index].stronger_non_loss_rate),
    elite_tail_separates_from_standard_d1: byId['d1-elite-v-d1-standard'].stronger_win_rate >= 0.43,
    elite_tail_remains_vulnerable: byId['d1-elite-v-d1-standard'].upset_rate > 0 && byId['d1-elite-v-lower-floor'].stronger_win_rate < 0.9,
    youth_matches_retain_uncertainty: byId['older-youth-v-new-youth'].upset_rate > 0
  });
  return Object.freeze({
    version: RATING_BAND_VALIDATION_VERSION,
    matches_per_pair: matchesPerPair,
    total_matches: matchesPerPair * scenarios.length,
    bands: TBG_RATING_BANDS,
    scenarios,
    checks,
    accepted: Object.values(checks).every(Boolean)
  });
}
