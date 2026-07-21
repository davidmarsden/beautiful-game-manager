import fs from 'node:fs';
import path from 'node:path';
import { syntheticPlayableLeagueStructure } from '../src/matchEngine/leagueStructureSimulation.js';
import { createPersistentLeagueWorld } from '../src/world/persistentLeagueWorld.js';
import { advancePersistentMatchday, runPersistentMatchdays } from '../src/world/persistentMatchdayWorld.js';
import { loadPersistentWorld } from '../src/world/persistentSeasonLoop.js';

const outputDir = path.resolve('reports/generated');
fs.mkdirSync(outputDir, { recursive: true });

function world() {
  const divisions = syntheticPlayableLeagueStructure({ clubsPerDivision: 4 });
  return createPersistentLeagueWorld({
    worldId: 'persistent-matchday-acceptance',
    divisions,
    humanClubId: divisions[0].clubs[0].club_id,
    movementCount: 1
  });
}

const continuous = runPersistentMatchdays({ world: world(), matchdays: 6 });
const firstHalf = runPersistentMatchdays({ world: world(), matchdays: 3 });
const resumed = runPersistentMatchdays({
  world: loadPersistentWorld(firstHalf.reports.at(-1).saved_world),
  matchdays: 3
});
const one = advancePersistentMatchday(world());

const report = {
  version: 'tbg-persistent-matchday-report-v1.0',
  generated_at: new Date().toISOString(),
  accepted: continuous.accepted
    && firstHalf.accepted
    && resumed.accepted
    && JSON.stringify(continuous.final_world) === JSON.stringify(resumed.final_world),
  checks: {
    first_matchday_persisted: one.accepted && one.world.matchday_cycle.current_matchday === 2,
    every_matchday_accepted: continuous.reports.every((row) => row.accepted),
    six_unique_checkpoints: new Set(continuous.reports.map((row) => row.checkpoint.checkpoint_id)).size === 6,
    sixty_fixtures_processed_once: continuous.reports.reduce((sum, row) => sum + row.checkpoint.fixture_count, 0) === 60,
    resumed_matches_continuous: JSON.stringify(continuous.final_world) === JSON.stringify(resumed.final_world),
    five_archives_created: continuous.final_world.history.archives.length === 5,
    eight_movements_persisted: continuous.final_world.competition.movement_history.length === 8,
    next_preseason_reached: continuous.final_world.phase === 'preseason' && continuous.final_world.season_number === 2
  },
  summary: {
    matchdays_completed: continuous.matchdays,
    divisions: 5,
    clubs: 20,
    fixtures_completed: continuous.reports.reduce((sum, row) => sum + row.checkpoint.fixture_count, 0),
    checkpoints_created: continuous.reports.length,
    archives_created: continuous.final_world.history.archives.length,
    movements_recorded: continuous.final_world.competition.movement_history.length,
    final_season_number: continuous.final_world.season_number,
    final_phase: continuous.final_world.phase
  },
  matchdays: continuous.reports.map((row) => ({
    matchday: row.matchday,
    fixture_count: row.checkpoint.fixture_count,
    accepted: row.accepted,
    season_completed: row.season_completed,
    checks: row.checks
  }))
};
report.accepted = report.accepted && Object.values(report.checks).every(Boolean);

const jsonPath = path.join(outputDir, 'persistent-matchday-world.json');
const markdownPath = path.join(outputDir, 'persistent-matchday-world.md');
fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
fs.writeFileSync(markdownPath, `# Persistent Matchday World Acceptance\n\n- Accepted: **${report.accepted}**\n- Matchdays: **${report.summary.matchdays_completed}**\n- Fixtures: **${report.summary.fixtures_completed}**\n- Checkpoints: **${report.summary.checkpoints_created}**\n- Division archives: **${report.summary.archives_created}**\n- Movements: **${report.summary.movements_recorded}**\n- Final phase: **${report.summary.final_phase}**\n\n## Checks\n\n${Object.entries(report.checks).map(([key, value]) => `- ${value ? '✅' : '❌'} ${key}`).join('\n')}\n`);

if (!report.accepted) {
  console.error(JSON.stringify(report, null, 2));
  process.exitCode = 1;
} else {
  console.log(`Persistent matchday world accepted: ${jsonPath}`);
}
