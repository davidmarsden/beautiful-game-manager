import { mkdir, writeFile } from 'node:fs/promises';
import { runRatingBandInvestigation } from '../src/matchEngine/ratingBandValidation.js';

const outputDirectory = new URL('../calibration/generated/', import.meta.url);
const report = runRatingBandInvestigation({ matchesPerPair: 1000 });

function markdown(result) {
  const lines = [
    '# Rating-band Calibration Investigation',
    '',
    `- Version: \`${result.version}\``,
    `- Matches per comparison: ${result.matches_per_pair}`,
    `- Total matches: ${result.total_matches}`,
    `- Common random numbers: ${result.common_random_numbers ? 'yes' : 'no'}`,
    ''
  ];

  for (const scenario of result.scenarios) {
    lines.push(
      `## ${scenario.scenario_id}`,
      '',
      `- Stronger band: ${scenario.stronger_band} (${scenario.stronger_average_rating})`,
      `- Weaker band: ${scenario.weaker_band} (${scenario.weaker_average_rating})`,
      `- Expected average rating gap: ${scenario.expected_average_rating_gap}`,
      `- W/D/L: ${scenario.outcome_counts.wins}/${scenario.outcome_counts.draws}/${scenario.outcome_counts.losses}`,
      `- Win/draw/upset rates: ${scenario.stronger_win_rate}/${scenario.draw_rate}/${scenario.upset_rate}`,
      `- Goals for/against: ${scenario.stronger_goals}/${scenario.weaker_goals}`,
      `- Total goal difference: ${scenario.total_goal_difference}`,
      `- Goal difference per match: ${scenario.goal_difference_per_match}`,
      '',
      '### Stronger XI',
      '',
      '| Player | Position | Rating |',
      '|---|---|---:|'
    );
    for (const player of scenario.stronger_fixture.players) lines.push(`| ${player.player_id} | ${player.position} | ${player.rating} |`);
    lines.push('', '### Weaker XI', '', '| Player | Position | Rating |', '|---|---|---:|');
    for (const player of scenario.weaker_fixture.players) lines.push(`| ${player.player_id} | ${player.position} | ${player.rating} |`);
    lines.push('');
  }

  lines.push(
    '## Comparison',
    '',
    `- Expected gap difference: ${result.comparison.expected_gap_difference}`,
    `- Stronger win-rate difference: ${result.comparison.stronger_win_rate_difference}`,
    `- Stronger non-loss-rate difference: ${result.comparison.stronger_non_loss_rate_difference}`,
    `- Goal-difference-per-match difference: ${result.comparison.goal_difference_per_match_difference}`,
    `- Equality persists: ${result.comparison.equality_persists ? 'yes' : 'no'}`,
    ''
  );
  return `${lines.join('\n')}\n`;
}

await mkdir(outputDirectory, { recursive: true });
await writeFile(new URL('rating-band-investigation.json', outputDirectory), `${JSON.stringify(report, null, 2)}\n`);
await writeFile(new URL('rating-band-investigation.md', outputDirectory), markdown(report));

console.log(JSON.stringify({
  accepted: true,
  matches_per_pair: report.matches_per_pair,
  comparison: report.comparison,
  outputs: [
    'calibration/generated/rating-band-investigation.json',
    'calibration/generated/rating-band-investigation.md'
  ]
}, null, 2));
