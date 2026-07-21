import fs from 'node:fs';
import path from 'node:path';
import { syntheticPlayableLeagueStructure } from '../src/matchEngine/leagueStructureSimulation.js';
import { createPersistentLeagueWorld, runPersistentLeagueSeasons } from '../src/world/persistentLeagueWorld.js';

const outputDir = path.resolve('reports/generated');
fs.mkdirSync(outputDir, { recursive: true });

const divisions = syntheticPlayableLeagueStructure({ clubsPerDivision: 4 });
const world = createPersistentLeagueWorld({
  worldId: 'persistent-five-division-acceptance',
  divisions,
  humanClubId: divisions[0].clubs[0].club_id,
  movementCount: 1
});
const run = runPersistentLeagueSeasons({ seasons: 2, world });

const report = {
  version: 'tbg-persistent-five-division-report-v1.0',
  generated_at: new Date().toISOString(),
  accepted: run.accepted,
  checks: run.checks,
  summary: {
    seasons_completed: run.seasons,
    division_count: run.final_world.competition.divisions.length,
    club_count: run.final_world.competition.divisions.reduce((sum, row) => sum + row.club_ids.length, 0),
    archives_created: run.final_world.history.archives.length,
    movements_recorded: run.final_world.competition.movement_history.length,
    final_season_number: run.final_world.season_number,
    final_phase: run.final_world.phase
  },
  seasons: run.reports.map((row) => ({
    completed_season_id: row.completed_season_id,
    next_season_id: row.next_season_id,
    accepted: row.accepted,
    archive_count: row.archives.length,
    movement_count: row.movements.length,
    movements: row.movements,
    checks: row.checks
  })),
  final_divisions: run.final_world.competition.divisions
};

const jsonPath = path.join(outputDir, 'persistent-five-division-world.json');
const markdownPath = path.join(outputDir, 'persistent-five-division-world.md');
fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
fs.writeFileSync(markdownPath, `# Persistent Five-Division World Acceptance\n\n- Accepted: **${report.accepted}**\n- Seasons: **${report.summary.seasons_completed}**\n- Divisions: **${report.summary.division_count}**\n- Clubs: **${report.summary.club_count}**\n- Archives: **${report.summary.archives_created}**\n- Movements: **${report.summary.movements_recorded}**\n- Final season: **${report.summary.final_season_number}**\n- Final phase: **${report.summary.final_phase}**\n\n## Checks\n\n${Object.entries(report.checks).map(([key, value]) => `- ${value ? '✅' : '❌'} ${key}`).join('\n')}\n\n## Seasons\n\n${report.seasons.map((season) => `### ${season.completed_season_id}\n\n- Accepted: **${season.accepted}**\n- Division archives: **${season.archive_count}**\n- Promotion/relegation movements: **${season.movement_count}**`).join('\n\n')}\n`);

if (!report.accepted) {
  console.error(JSON.stringify(report, null, 2));
  process.exitCode = 1;
} else {
  console.log(`Persistent five-division world accepted: ${jsonPath}`);
}
