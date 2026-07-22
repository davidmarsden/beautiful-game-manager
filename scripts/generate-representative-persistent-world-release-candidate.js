import fs from 'node:fs';
import path from 'node:path';
import {
  buildRepresentativePersistentWorldReleaseCandidate,
  DEFAULT_REPRESENTATIVE_CLUBS_PER_DIVISION,
  DEFAULT_REPRESENTATIVE_SEASONS
} from '../src/release/representativePersistentWorldReleaseCandidate.js';

const outputDir = path.resolve('reports/generated');
fs.mkdirSync(outputDir, { recursive: true });

const report = buildRepresentativePersistentWorldReleaseCandidate({
  clubsPerDivision: DEFAULT_REPRESENTATIVE_CLUBS_PER_DIVISION,
  seasons: DEFAULT_REPRESENTATIVE_SEASONS
});

const jsonPath = path.join(outputDir, 'representative-persistent-world-release-candidate.json');
const markdownPath = path.join(outputDir, 'representative-persistent-world-release-candidate.md');
fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
fs.writeFileSync(markdownPath, `# Representative Persistent-World Release Candidate\n\n- Release candidate: **${report.release_candidate}**\n- Accepted: **${report.accepted}**\n- Divisions: **${report.profile.divisions}**\n- Clubs: **${report.profile.clubs}** (${report.profile.clubs_per_division} per division)\n- Seasons: **${report.profile.seasons}**\n- Matchdays: **${report.profile.total_matchdays}**\n- Fixtures: **${report.metrics.fixtures_completed}**\n- Players: **${report.metrics.players_in_universe}**\n- Final save: **${report.metrics.final_save_bytes.toLocaleString()} bytes**\n- Runtime: **${report.metrics.runtime_ms.toLocaleString()} ms**\n- Final phase: **${report.metrics.final_phase}**\n\n## Checks\n\n${Object.entries(report.checks).map(([key, value]) => `- ${value ? '✅' : '❌'} ${key}`).join('\n')}\n`);

if (!report.accepted) {
  console.error(JSON.stringify(report, null, 2));
  process.exitCode = 1;
} else {
  console.log(`Representative persistent-world RC accepted: ${jsonPath}`);
}
