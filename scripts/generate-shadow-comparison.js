import fs from 'node:fs';
import path from 'node:path';
import { runShadowComparison } from '../src/matchEngine/shadowComparison.js';

const outputDirectory = path.resolve('calibration/generated');
fs.mkdirSync(outputDirectory, { recursive: true });

const report = runShadowComparison({ matchesPerScenario: 200 });
const jsonPath = path.join(outputDirectory, 'shadow-comparison.json');
const markdownPath = path.join(outputDirectory, 'shadow-comparison.md');

const percent = (value) => value == null ? 'n/a' : `${(value * 100).toFixed(1)}%`;
const signed = (value) => `${value >= 0 ? '+' : ''}${value}`;
const lines = [
  '# Compatibility vs constitutional shadow comparison',
  '',
  `- Version: \`${report.version}\``,
  `- Common deterministic fixtures: **${report.generated_from_common_fixtures ? 'yes' : 'no'}**`,
  `- Matches per scenario: **${report.matches_per_scenario}**`,
  `- Total paired fixtures: **${report.total_matches}**`,
  `- Public contract compatible: **${report.public_contract.compatible ? 'PASS' : 'FAIL'}**`,
  `- Shadow gate: **${report.accepted ? 'PASS' : 'HOLD'}**`,
  `- Recommendation: \`${report.recommendation}\``,
  '',
  '## Aggregate comparison',
  '',
  '| Metric | Compatibility | Constitutional | Delta |',
  '|---|---:|---:|---:|',
  `| Average total goals | ${report.aggregate.compatibility.average_total_goals} | ${report.aggregate.constitutional.average_total_goals} | ${signed(report.aggregate.deltas.average_total_goals)} |`,
  `| Home win rate | ${percent(report.aggregate.compatibility.home_win_rate)} | ${percent(report.aggregate.constitutional.home_win_rate)} | ${percent(report.aggregate.deltas.home_win_rate)} |`,
  `| Draw rate | ${percent(report.aggregate.compatibility.draw_rate)} | ${percent(report.aggregate.constitutional.draw_rate)} | ${percent(report.aggregate.deltas.draw_rate)} |`,
  `| Stronger-team non-loss rate | ${percent(report.aggregate.compatibility.stronger_team_non_loss_rate)} | ${percent(report.aggregate.constitutional.stronger_team_non_loss_rate)} | ${percent(report.aggregate.deltas.stronger_team_non_loss_rate)} |`,
  `| Exact score match rate | — | — | ${percent(report.aggregate.deltas.exact_score_match_rate)} |`,
  `| Outcome match rate | — | — | ${percent(report.aggregate.deltas.outcome_match_rate)} |`,
  `| Mean absolute goals delta per side | — | — | ${report.aggregate.deltas.average_absolute_goal_delta} |`,
  '',
  '## Scenario comparison',
  '',
  '| Scenario | Ratings | Compatibility goals | Constitutional goals | Compatibility W/D/L | Constitutional W/D/L |',
  '|---|---:|---:|---:|---:|---:|',
  ...report.scenarios.map((row) => {
    const legacy = row.compatibility;
    const next = row.constitutional;
    const wdl = (value) => `${percent(value.home_win_rate)} / ${percent(value.draw_rate)} / ${percent(value.away_win_rate)}`;
    return `| ${row.scenario_id} | ${row.home_rating}–${row.away_rating} | ${legacy.average_total_goals} | ${next.average_total_goals} | ${wdl(legacy)} | ${wdl(next)} |`;
  }),
  '',
  '## Acceptance checks',
  '',
  ...Object.entries(report.checks).map(([key, value]) => `- ${value ? '✅' : '❌'} ${key}`),
  '',
  '## Interpretation boundary',
  '',
  'This report does not require identical match scores. It verifies that both engines receive the same deterministic fixture population, that their aggregate distributions remain within explicit tolerances, and that both preserve the established `2d5-v1` public result envelope.'
];

fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
fs.writeFileSync(markdownPath, `${lines.join('\n')}\n`);
console.log(JSON.stringify({ json: jsonPath, markdown: markdownPath, accepted: report.accepted, recommendation: report.recommendation }, null, 2));

if (!report.accepted) process.exitCode = 1;
