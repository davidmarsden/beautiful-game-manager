import fs from 'node:fs';
import path from 'node:path';
import { buildPlayableWorldReleaseCandidate } from '../src/release/playableWorldReleaseCandidate.js';

const outputDir = path.resolve('reports/generated');
fs.mkdirSync(outputDir, { recursive: true });

const report = buildPlayableWorldReleaseCandidate({
  seasons: 12,
  clubCount: 4,
  worldId: 'playable-world-release-candidate'
});

const jsonPath = path.join(outputDir, 'playable-world-release-candidate.json');
const markdownPath = path.join(outputDir, 'playable-world-release-candidate.md');

fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
fs.writeFileSync(markdownPath, `# Playable World Release Candidate\n\n- Version: **${report.version}**\n- Candidate: **${report.release_candidate}**\n- Accepted: **${report.accepted}**\n- Soak seasons: **${report.seasons}**\n- Clubs: **${report.club_count}**\n- Fixtures completed: **${report.metrics.fixtures_completed}**\n- Archives created: **${report.metrics.archives_created}**\n- Human decisions recorded: **${report.metrics.human_decisions_recorded}**\n- AI squad-management cycles: **${report.metrics.ai_preseason_cycles}**\n- Players in final universe: **${report.metrics.players_in_universe}**\n- Final save size: **${report.metrics.final_save_bytes} bytes**\n- Final season number: **${report.metrics.final_season_number}**\n\n## Acceptance checks\n\n${Object.entries(report.checks).map(([key, value]) => `- ${value ? '✅' : '❌'} ${key}`).join('\n')}\n\n## Season summaries\n\n${report.season_summaries.map((season) => `### ${season.season_id}\n\n- Accepted: **${season.accepted}**\n- Champion: **${season.champion_club_id}**\n- Human position: **${season.human_position}**\n- Fixtures: **${season.fixture_count}**\n- Human decisions: **${season.human_decisions}**\n- Players released: **${season.released_players}**\n- Next squads viable: **${season.next_squads_viable}**`).join('\n\n')}\n\n## Persistence identity\n\n- Continuous save SHA-256: \`${report.metrics.final_save_sha256}\`\n- Resumed save SHA-256: \`${report.metrics.resumed_save_sha256}\`\n`);

if (!report.accepted) {
  console.error(JSON.stringify(report, null, 2));
  process.exitCode = 1;
} else {
  console.log(`Playable-world release candidate accepted: ${jsonPath}`);
}
