import fs from 'node:fs';
import path from 'node:path';
import { syntheticSeasonClubs } from '../src/matchEngine/seasonSimulation.js';
import { createPersistentWorld, runPersistentWorldSeasons } from '../src/world/persistentSeasonLoop.js';

const outputDir = path.resolve('reports/generated');
fs.mkdirSync(outputDir, { recursive: true });

const world = createPersistentWorld({
  worldId: 'persistent-world-acceptance',
  clubs: syntheticSeasonClubs({ clubCount: 4, baseRating: 86 }),
  humanClubId: 'club-1'
});

const run = runPersistentWorldSeasons({
  seasons: 2,
  world,
  defaultInstruction: {
    formation: '4-3-3-wide',
    tactics: { style: 'possession', route_to_goal: 'wide', pressing: 'mid', tempo: 'normal', mentality: 'positive' }
  }
});

const report = {
  version: 'tbg-persistent-world-loop-report-v1.0',
  generated_at: new Date().toISOString(),
  accepted: run.accepted,
  checks: run.checks,
  summary: {
    seasons_completed: run.reports.length,
    final_season_number: run.final_world.season_number,
    archive_count: run.final_world.history.archives.length,
    world_event_count: run.final_world.event_ledger.length,
    squad_cycle_event_count: run.final_world.squad_cycle.events.length,
    checkpoint_count: run.final_world.checkpoints.length,
    human_club_id: run.final_world.human_club_id,
    final_phase: run.final_world.phase
  },
  seasons: run.reports.map((row) => ({
    season_id: row.season_id,
    next_season_id: row.next_season_id,
    accepted: row.accepted,
    checks: row.checks,
    champion_club_id: row.archive.summary.champion_club_id,
    human_final_standing: row.season.final_standing,
    human_decisions: row.season.decisions.length,
    ai_clubs_managed_before_season: row.ai_preseason.length,
    ai_clubs_managed_after_rollover: row.ai_next_preseason.length,
    released_players: row.released_player_ids.length,
    next_season_viability: row.next_season_viability
  }))
};

const jsonPath = path.join(outputDir, 'persistent-world-loop-report.json');
const markdownPath = path.join(outputDir, 'persistent-world-loop-report.md');
fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
fs.writeFileSync(markdownPath, `# Persistent World Season Loop Acceptance\n\n- Accepted: **${report.accepted}**\n- Seasons completed: **${report.summary.seasons_completed}**\n- Final season number: **${report.summary.final_season_number}**\n- Archives: **${report.summary.archive_count}**\n- World events: **${report.summary.world_event_count}**\n- Squad-cycle events: **${report.summary.squad_cycle_event_count}**\n- Save/load checkpoints: **${report.summary.checkpoint_count}**\n- Final phase: **${report.summary.final_phase}**\n\n## Checks\n\n${Object.entries(report.checks).map(([key, value]) => `- ${value ? '✅' : '❌'} ${key}`).join('\n')}\n\n## Seasons\n\n${report.seasons.map((season) => `### ${season.season_id}\n\n- Accepted: **${season.accepted}**\n- Champion: **${season.champion_club_id}**\n- Human club position: **${season.human_final_standing.position}**\n- Human fixture decisions: **${season.human_decisions}**\n- AI clubs managed before season: **${season.ai_clubs_managed_before_season}**\n- AI clubs managed after rollover: **${season.ai_clubs_managed_after_rollover}**\n- Released players: **${season.released_players}**\n- Next-season squads viable: **${season.next_season_viability.every((row) => row.viable)}**`).join('\n\n')}\n`);

if (!report.accepted) {
  console.error(JSON.stringify(report, null, 2));
  process.exitCode = 1;
} else {
  console.log(`Persistent world loop accepted: ${jsonPath}`);
}
