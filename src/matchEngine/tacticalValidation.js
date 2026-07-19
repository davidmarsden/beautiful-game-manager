import { resolveTeamTactics, resolveTacticalMatchup } from './modules/TacticalResolution.js';
import { simulateMatch, MATCH_ENGINE_MODES } from '../matchSimulation.js';

const round = (value, places = 4) => Number(Number(value).toFixed(places));
const average = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

export const TACTICAL_VALIDATION_VERSION = 'tbg-tactical-validation-v1.1';
export const UPSET_CURVE_STEP_TOLERANCE = 0.01;

export const TACTICAL_DIMENSIONS = Object.freeze({
  formations: Object.freeze(['4-4-2', '4-3-3-wide', '4-2-3-1', '4-1-4-1', '3-5-2', '3-4-3', '5-3-2']),
  styles: Object.freeze(['possession', 'counter_transition', 'direct', 'high_press', 'low_block', 'balanced']),
  routes: Object.freeze(['central', 'balanced', 'wide'])
});

function packageId(row) {
  return `${row.formation}|${row.style}|${row.route_to_goal}`;
}

function teamForPackage(row, side) {
  return {
    side,
    club_id: `${side}-${packageId(row)}`,
    formation: row.formation,
    tactics: {
      style: row.style,
      route_to_goal: row.route_to_goal,
      pressing: row.style === 'high_press' ? 'high' : row.style === 'low_block' ? 'low' : 'mid',
      tempo: row.style === 'direct' || row.style === 'counter_transition' ? 'fast' : row.style === 'possession' ? 'slow' : 'normal',
      mentality: 'balanced'
    }
  };
}

export function tacticalPackages() {
  const rows = [];
  for (const formation of TACTICAL_DIMENSIONS.formations) {
    for (const style of TACTICAL_DIMENSIONS.styles) {
      for (const route_to_goal of TACTICAL_DIMENSIONS.routes) rows.push(Object.freeze({ formation, style, route_to_goal }));
    }
  }
  return Object.freeze(rows);
}

export function buildTacticalDiversityMatrix() {
  const packages = tacticalPackages();
  const resolved = new Map(packages.map((row) => [packageId(row), resolveTeamTactics(teamForPackage(row, 'home'), 'home')]));
  const rows = [];
  const records = new Map(packages.map((row) => [packageId(row), { wins: 0, losses: 0, draws: 0, best: -Infinity, worst: Infinity }]));

  for (const homePackage of packages) {
    for (const awayPackage of packages) {
      const homeId = packageId(homePackage);
      const awayId = packageId(awayPackage);
      const matchup = resolveTacticalMatchup(resolved.get(homeId), resolved.get(awayId));
      const advantage = matchup.net.home_advantage;
      rows.push(Object.freeze({ home_package: homeId, away_package: awayId, home_advantage: advantage }));
      if (homeId !== awayId) {
        const record = records.get(homeId);
        if (advantage > 0.0001) record.wins += 1;
        else if (advantage < -0.0001) record.losses += 1;
        else record.draws += 1;
        record.best = Math.max(record.best, advantage);
        record.worst = Math.min(record.worst, advantage);
      }
    }
  }

  const packageRecords = [...records.entries()].map(([id, row]) => Object.freeze({
    package: id,
    wins: row.wins,
    losses: row.losses,
    draws: row.draws,
    best_matchup: round(row.best),
    worst_matchup: round(row.worst),
    win_rate: round(row.wins / Math.max(1, row.wins + row.losses + row.draws))
  }));
  const uniqueAdvantages = new Set(rows.map((row) => row.home_advantage)).size;
  const champion = [...packageRecords].sort((left, right) => right.win_rate - left.win_rate || left.package.localeCompare(right.package))[0];
  const checks = Object.freeze({
    complete_cartesian_matrix: rows.length === packages.length * packages.length,
    advantages_stay_bounded: rows.every((row) => row.home_advantage >= -0.15 && row.home_advantage <= 0.15),
    equal_and_opposite_matchups: rows.every((row) => {
      const reverse = rows.find((candidate) => candidate.home_package === row.away_package && candidate.away_package === row.home_package);
      return reverse && Math.abs(row.home_advantage + reverse.home_advantage) < 0.0002;
    }),
    meaningful_tactical_diversity: uniqueAdvantages >= 20,
    every_committed_style_has_a_counter: packageRecords
      .filter((row) => !row.package.includes('|balanced|'))
      .every((row) => row.losses > 0),
    no_package_beats_every_other_package: packageRecords.every((row) => row.losses > 0 || row.draws > 0),
    leading_package_has_countervailing_exposure: champion.worst_matchup < 0
  });

  return Object.freeze({
    version: TACTICAL_VALIDATION_VERSION,
    package_count: packages.length,
    matchup_count: rows.length,
    unique_advantage_values: uniqueAdvantages,
    champion,
    package_records: Object.freeze(packageRecords),
    matrix: Object.freeze(rows),
    checks,
    accepted: Object.values(checks).every(Boolean)
  });
}

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
    tactics: { style: 'balanced', route_to_goal: 'balanced', pressing: 'mid', tempo: 'normal', mentality: 'balanced' }
  };
}

function outcomeForStrongSide(score, strongerSide) {
  const strong = strongerSide === 'home' ? score.home : score.away;
  const weak = strongerSide === 'home' ? score.away : score.home;
  return strong > weak ? 'win' : strong === weak ? 'draw' : 'loss';
}

function adjacentCurveSteps(rows) {
  return rows.slice(1).map((row, index) => Object.freeze({
    from_gap: rows[index].rating_gap,
    to_gap: row.rating_gap,
    stronger_win_rate_change: round(row.stronger_win_rate - rows[index].stronger_win_rate),
    upset_rate_change: round(row.upset_rate - rows[index].upset_rate),
    stronger_win_rate_non_decreasing: row.stronger_win_rate + UPSET_CURVE_STEP_TOLERANCE >= rows[index].stronger_win_rate,
    upset_rate_non_increasing: row.upset_rate <= rows[index].upset_rate + UPSET_CURVE_STEP_TOLERANCE
  }));
}

export function validateUpsetCurve({ gaps = [2, 4, 6, 10], matchesPerGap = 120, simulator = simulateMatch } = {}) {
  if (!Array.isArray(gaps) || gaps.length < 2) throw new Error('Upset validation requires at least two rating gaps');
  if (matchesPerGap < 40) throw new Error('Upset validation requires at least 40 matches per rating gap');
  const orderedGaps = [...gaps].map(Number).sort((left, right) => left - right);
  if (orderedGaps.some((gap) => !Number.isFinite(gap) || gap <= 0)) throw new Error('Upset validation rating gaps must be positive numbers');
  if (new Set(orderedGaps).size !== orderedGaps.length) throw new Error('Upset validation rating gaps must be unique');
  const rows = [];

  for (const gap of orderedGaps) {
    const outcomes = [];
    for (let index = 0; index < matchesPerGap; index += 1) {
      const strongerSide = index % 2 === 0 ? 'home' : 'away';
      const homeRating = strongerSide === 'home' ? 90 : 90 - gap;
      const awayRating = strongerSide === 'away' ? 90 : 90 - gap;
      const homePrefix = `gap-${gap}-match-${index}-home`;
      const awayPrefix = `gap-${gap}-match-${index}-away`;
      const world = { players: [...players(homePrefix, homeRating), ...players(awayPrefix, awayRating)] };
      const contract = {
        contract_version: '2d2-v1',
        engine_mode: MATCH_ENGINE_MODES.constitutional,
        run_key: `upset-validation:${gap}:${index}`,
        fixture: { fixture_id: `upset-${gap}-${index}`, season_id: 'upset-validation', matchday: index + 1, kickoff_at: '2026-07-19T15:00:00.000Z' },
        teams: { home: team('home', homePrefix), away: team('away', awayPrefix) }
      };
      const result = simulator(contract, world);
      outcomes.push(outcomeForStrongSide(result.score, strongerSide));
    }
    rows.push(Object.freeze({
      rating_gap: gap,
      sample_size: matchesPerGap,
      stronger_win_rate: round(outcomes.filter((row) => row === 'win').length / matchesPerGap),
      draw_rate: round(outcomes.filter((row) => row === 'draw').length / matchesPerGap),
      upset_rate: round(outcomes.filter((row) => row === 'loss').length / matchesPerGap)
    }));
  }

  const steps = adjacentCurveSteps(rows);
  const checks = Object.freeze({
    every_gap_retains_upset_possibility: rows.every((row) => row.upset_rate > 0),
    stronger_teams_are_never_certain: rows.every((row) => row.stronger_win_rate < 1),
    every_gap_step_preserves_stronger_team_trend: steps.every((step) => step.stronger_win_rate_non_decreasing),
    every_gap_step_preserves_upset_trend: steps.every((step) => step.upset_rate_non_increasing),
    probability_mass_reconciles: rows.every((row) => Math.abs(row.stronger_win_rate + row.draw_rate + row.upset_rate - 1) < 0.001)
  });

  return Object.freeze({
    version: TACTICAL_VALIDATION_VERSION,
    matches_per_gap: matchesPerGap,
    total_matches: matchesPerGap * rows.length,
    curve_step_tolerance: UPSET_CURVE_STEP_TOLERANCE,
    curves: Object.freeze(rows),
    adjacent_steps: Object.freeze(steps),
    average_upset_rate: round(average(rows.map((row) => row.upset_rate))),
    checks,
    accepted: Object.values(checks).every(Boolean)
  });
}

export function runTacticalAndUpsetValidation(options = {}) {
  const tactical = buildTacticalDiversityMatrix();
  const upsets = validateUpsetCurve(options);
  return Object.freeze({ version: TACTICAL_VALIDATION_VERSION, tactical, upsets, accepted: tactical.accepted && upsets.accepted });
}
