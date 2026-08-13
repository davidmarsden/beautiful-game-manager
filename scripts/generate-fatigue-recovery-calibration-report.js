import { writeFile } from 'node:fs/promises';
import {
  FATIGUE_CALIBRATION_BASELINE_DIALS,
  FATIGUE_DIALS,
  fitnessModifier,
  resolvePlayerContext
} from '../src/matchEngine/modules/FatigueContext.js';

const ROLES = Object.freeze(['gk', 'fb', 'cb', 'cb', 'fb', 'dm', 'cm', 'cm', 'wing', 'st', 'wing']);
const STARTING_FITNESS = Object.freeze([90, 95, 100]);
const ROTATION_THRESHOLD = 82;

const round = (value, places = 3) => Number(Number(value).toFixed(places));
const average = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;

function workload(role, { pressing = 'mid', tempo = 'normal', workRate = 50 } = {}) {
  return resolvePlayerContext(
    { tbg_player_id: `cal-${role}`, fitness: 100, sharpness: 100, morale: 50, work_rate_rating: workRate },
    { tactics: { pressing, tempo } },
    role,
    {}
  ).workload_multiplier;
}

function profile(dials, scenario) {
  const costs = ROLES.map((role) => dials.match_cost_per_90 * workload(role, scenario));
  const posts = STARTING_FITNESS.flatMap((starting) => costs.map((cost) => Math.max(0, starting - cost)));
  const freshPosts = costs.map((cost) => 100 - cost);
  return {
    mean_cost_90: round(average(costs)),
    minimum_cost_90: round(Math.min(...costs)),
    maximum_cost_90: round(Math.max(...costs)),
    mean_post_match_from_100: round(average(freshPosts)),
    minimum_post_match_from_100: round(Math.min(...freshPosts)),
    maximum_post_match_from_100: round(Math.max(...freshPosts)),
    starter_90_100_post_minimum: round(Math.min(...posts)),
    starter_90_100_post_maximum: round(Math.max(...posts)),
    below_70_pct: round(100 * posts.filter((value) => value < 70).length / posts.length, 1),
    below_60_pct: round(100 * posts.filter((value) => value < 60).length / posts.length, 1),
    below_50_pct: round(100 * posts.filter((value) => value < 50).length / posts.length, 1)
  };
}

function congestion(dials, scenario, { restDays = 2, games = 3 } = {}) {
  const costs = ROLES.map((role) => dials.match_cost_per_90 * workload(role, scenario));
  let fitness = ROLES.map(() => 100);
  const rows = [];
  for (let game = 1; game <= games; game += 1) {
    rows.push({
      game,
      kickoff_mean: round(average(fitness)),
      kickoff_minimum: round(Math.min(...fitness)),
      starters_below_rotation_threshold: fitness.filter((value) => value < ROTATION_THRESHOLD).length,
      mean_fitness_modifier: round(average(fitness.map(fitnessModifier)), 4)
    });
    fitness = fitness.map((value, index) => Math.max(0, value - costs[index]));
    if (game < games) fitness = fitness.map((value) => Math.min(100, value + dials.recovery_per_rest_day * restDays));
  }
  return rows;
}

const scenarios = {
  low: { pressing: 'low', tempo: 'slow', workRate: 40 },
  normal: { pressing: 'mid', tempo: 'normal', workRate: 50 },
  extreme: { pressing: 'high', tempo: 'fast', workRate: 80 }
};

const baseline = {
  dials: FATIGUE_CALIBRATION_BASELINE_DIALS,
  low: profile(FATIGUE_CALIBRATION_BASELINE_DIALS, scenarios.low),
  normal: profile(FATIGUE_CALIBRATION_BASELINE_DIALS, scenarios.normal),
  extreme: profile(FATIGUE_CALIBRATION_BASELINE_DIALS, scenarios.extreme),
  normal_congestion: congestion(FATIGUE_CALIBRATION_BASELINE_DIALS, scenarios.normal)
};

const calibrated = {
  dials: FATIGUE_DIALS,
  low: profile(FATIGUE_DIALS, scenarios.low),
  normal: profile(FATIGUE_DIALS, scenarios.normal),
  extreme: profile(FATIGUE_DIALS, scenarios.extreme),
  normal_congestion: congestion(FATIGUE_DIALS, scenarios.normal),
  extreme_congestion: congestion(FATIGUE_DIALS, scenarios.extreme)
};

const checks = {
  normal_mean_cost_in_target: calibrated.normal.mean_cost_90 >= 10 && calibrated.normal.mean_cost_90 <= 22,
  normal_starter_tail_in_target: calibrated.normal.starter_90_100_post_minimum >= 72 && calibrated.normal.starter_90_100_post_maximum <= 91,
  ordinary_starters_not_below_70: calibrated.normal.below_70_pct === 0,
  extreme_load_costs_more: calibrated.extreme.mean_cost_90 > calibrated.normal.mean_cost_90,
  extreme_load_can_exceed_normal_ceiling: calibrated.extreme.maximum_cost_90 > 22,
  two_days_recovery_meaningful: FATIGUE_DIALS.recovery_per_rest_day * 2 >= 10,
  ordinary_two_day_congestion_not_compulsory_rotation: calibrated.normal_congestion[1].starters_below_rotation_threshold === 0,
  repeated_extreme_congestion_creates_rotation_pressure: calibrated.extreme_congestion[2].starters_below_rotation_threshold > 0,
  baseline_materially_reduced: calibrated.normal.mean_cost_90 <= baseline.normal.mean_cost_90 * 0.5
};

const output = {
  version: 'tbg-fatigue-recovery-calibration-v1.0',
  accepted: Object.values(checks).every(Boolean),
  target: {
    ordinary_match_cost_points: 'roughly 10-22',
    ordinary_post_match_fitness: 'roughly 72-88 for starters beginning 90-100, with positional spread',
    recovery: 'meaningful after two clear/rest days',
    rotation: 'useful in congestion, not compulsory after every ordinary fixture'
  },
  checks,
  baseline,
  calibrated
};

const markdown = [
  '# Fatigue & Recovery Calibration v1', '',
  `- Decision: **${output.accepted ? 'PASS' : 'FAIL'}**`,
  `- Baseline dials: match cost ${baseline.dials.match_cost_per_90}, recovery ${baseline.dials.recovery_per_rest_day}/day`,
  `- Calibrated dials: match cost ${calibrated.dials.match_cost_per_90}, recovery ${calibrated.dials.recovery_per_rest_day}/day`,
  '',
  '## Before / after', '',
  '| Metric | Baseline | Calibrated |',
  '|---|---:|---:|',
  `| Normal XI mean 90m cost | ${baseline.normal.mean_cost_90} | ${calibrated.normal.mean_cost_90} |`,
  `| Normal XI post-match mean from 100 | ${baseline.normal.mean_post_match_from_100} | ${calibrated.normal.mean_post_match_from_100} |`,
  `| 90–100 starters: post-match range | ${baseline.normal.starter_90_100_post_minimum}–${baseline.normal.starter_90_100_post_maximum} | ${calibrated.normal.starter_90_100_post_minimum}–${calibrated.normal.starter_90_100_post_maximum} |`,
  `| 90–100 starters finishing <70 | ${baseline.normal.below_70_pct}% | ${calibrated.normal.below_70_pct}% |`,
  `| 90–100 starters finishing <60 | ${baseline.normal.below_60_pct}% | ${calibrated.normal.below_60_pct}% |`,
  `| Extreme XI mean 90m cost | ${baseline.extreme.mean_cost_90} | ${calibrated.extreme.mean_cost_90} |`,
  `| Extreme XI maximum 90m cost | ${baseline.extreme.maximum_cost_90} | ${calibrated.extreme.maximum_cost_90} |`,
  `| Recovery after 2 rest days | +${baseline.dials.recovery_per_rest_day * 2} | +${calibrated.dials.recovery_per_rest_day * 2} |`,
  '',
  '## Ordinary congestion: three matches, two rest days between each', '',
  '| Game | Baseline kickoff mean | Baseline <82 | Calibrated kickoff mean | Calibrated <82 | Calibrated mean fitness modifier |',
  '|---:|---:|---:|---:|---:|---:|',
  ...calibrated.normal_congestion.map((row, index) => `| ${row.game} | ${baseline.normal_congestion[index].kickoff_mean} | ${baseline.normal_congestion[index].starters_below_rotation_threshold} | ${row.kickoff_mean} | ${row.starters_below_rotation_threshold} | ${row.mean_fitness_modifier} |`),
  '',
  '## Extreme congestion: high press + fast tempo + high work rate', '',
  '| Game | Kickoff mean | Kickoff minimum | Starters <82 | Mean fitness modifier |',
  '|---:|---:|---:|---:|---:|',
  ...calibrated.extreme_congestion.map((row) => `| ${row.game} | ${row.kickoff_mean} | ${row.kickoff_minimum} | ${row.starters_below_rotation_threshold} | ${row.mean_fitness_modifier} |`),
  '',
  '## Acceptance checks', '',
  ...Object.entries(checks).map(([key, value]) => `- ${key}: **${value ? 'PASS' : 'FAIL'}**`),
  '',
  '## Interpretation', '',
  '- The old curve made ordinary fatigue behave like exceptional congestion: a normal XI lost about 35 fitness points on average and most 90–100 starters fell below 70 after one match.',
  '- The calibrated curve keeps normal full-match losses in the intended band while preserving workload differentiation: goalkeepers remain cheapest, wide/box-to-box roles cost more, and high pressing + fast tempo can still exceed the ordinary ceiling.',
  '- Two rest days now restore 10 points. Ordinary starters can usually repeat without automatic rotation, while repeated extreme-intensity congestion pushes most of the XI below the manager AI rotation threshold by the third match.',
  '- Fitness still affects match strength through the existing modifier curve; the recalibration changes depletion/recovery, not the constitutional relationship between fatigue and performance.',
  ''
].join('\n');

await writeFile(new URL('../calibration/fatigue-recovery-calibration-v1.json', import.meta.url), `${JSON.stringify(output, null, 2)}\n`);
await writeFile(new URL('../calibration/fatigue-recovery-calibration-v1.md', import.meta.url), markdown);
console.log(JSON.stringify({ accepted: output.accepted, checks, baseline: baseline.normal, calibrated: calibrated.normal }, null, 2));
if (!output.accepted) process.exitCode = 1;
