import fs from 'node:fs';
import path from 'node:path';
import { simulateStatefulSeason, syntheticSeasonClubs } from '../src/matchEngine/seasonSimulation.js';
import { appendSeasonArchive, createSeasonArchive } from '../src/history/seasonArchive.js';

const season = simulateStatefulSeason({
  clubs: syntheticSeasonClubs({ clubCount: 6, baseRating: 86 }),
  seasonId: 'season-archive-foundation-season',
  startAt: '2026-08-01T15:00:00.000Z'
});
const archive = createSeasonArchive(season, { archivedAt: '2027-07-01T00:00:00.000Z' });
const history = appendSeasonArchive(null, archive);

const checks = {
  archive_accepted: archive.accepted,
  champion_matches_final_table: archive.awards.champion?.club_id === season.standings[0]?.club_id,
  fixture_links_complete: archive.source_fixture_ids.length === season.fixture_count,
  club_totals_reconcile: archive.checks.standings_reconcile && archive.checks.standings_match_fixture_scores && archive.checks.goals_reconcile,
  player_starts_reconcile: archive.checks.player_starts_reconcile,
  appearances_cover_starts: archive.checks.player_appearances_cover_starts,
  public_events_preserved: season.results.every((row) => Array.isArray(row.events)),
  deterministic_awards_present: Boolean(archive.awards.champion && archive.awards.best_attack && archive.awards.best_defence && archive.awards.appearance_leader),
  history_index_created: history.archives.length === 1
};

const report = {
  version: 'tbg-season-archive-report-v1.1',
  accepted: Object.values(checks).every(Boolean),
  checks,
  evidence: {
    season_id: archive.season_id,
    fixture_count: archive.summary.fixture_count,
    club_count: archive.summary.club_count,
    total_goals: archive.summary.total_goals,
    preserved_event_count: season.results.reduce((sum, row) => sum + row.events.length, 0),
    champion: archive.awards.champion,
    best_attack: archive.awards.best_attack,
    best_defence: archive.awards.best_defence,
    appearance_leader: archive.awards.appearance_leader,
    record_keys: Object.keys(archive.records),
    archive_checks: archive.checks
  },
  archive
};

const outDir = path.resolve('calibration/generated');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'season-archive.json'), `${JSON.stringify(report, null, 2)}\n`);
const markdown = [
  '# End-of-season archive acceptance',
  '',
  `- Accepted: **${report.accepted}**`,
  `- Season: **${archive.season_id}**`,
  `- Fixtures archived: **${archive.summary.fixture_count}**`,
  `- Champion: **${archive.awards.champion?.club_id}**`,
  `- Total goals: **${archive.summary.total_goals}**`,
  `- Public events preserved: **${report.evidence.preserved_event_count}**`,
  '',
  '## Checks',
  ...Object.entries(checks).map(([key, value]) => `- ${key}: ${value ? 'PASS' : 'FAIL'}`),
  '',
  '## Awards',
  `- Best attack: ${archive.awards.best_attack?.club_id} (${archive.awards.best_attack?.goals_for})`,
  `- Best defence: ${archive.awards.best_defence?.club_id} (${archive.awards.best_defence?.goals_against})`,
  `- Appearance leader: ${archive.awards.appearance_leader?.player_id} (${archive.awards.appearance_leader?.appearances})`,
  ''
].join('\n');
fs.writeFileSync(path.join(outDir, 'season-archive.md'), markdown);

if (!report.accepted) process.exitCode = 1;
console.log(JSON.stringify(report, null, 2));
