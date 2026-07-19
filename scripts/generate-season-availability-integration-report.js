import { mkdir, writeFile } from 'node:fs/promises';
import { simulateStatefulSeason, syntheticSeasonClubs } from '../src/matchEngine/seasonSimulation.js';

const records = [];
let first = true;
const simulator = (contract) => {
  records.push({ fixture: contract.fixture, teams: contract.teams });
  const injuries = first
    ? [{ player_id: contract.teams.home.starting_xi[0], matches_out: 2, injury_type: 'calibration_injury' }]
    : [];
  first = false;
  return {
    result_version: '2d5-v1', run_key: contract.run_key, fixture_id: contract.fixture.fixture_id,
    status: 'completed', score: { home: 1, away: 0 }, outcome: 'home_win', events: [],
    statistics: { home: {}, away: {} }, lineup_state: {},
    state_changes: { fitness: [], injuries, discipline: [] }
  };
};

const report = simulateStatefulSeason({
  clubs: syntheticSeasonClubs({ clubCount: 4 }),
  seasonId: 'season-availability-integration-report',
  startAt: '2026-08-01T15:00:00.000Z',
  simulator
});

const output = {
  version: 'tbg-season-availability-integration-report-v1.0',
  accepted: report.accepted,
  season_version: report.version,
  fixture_count: report.fixture_count,
  metrics: report.metrics,
  checks: report.checks,
  absence_rows: report.results.flatMap((row) => row.availability_changes.map((change) => ({
    fixture_id: row.fixture.fixture_id,
    matchday: row.fixture.matchday,
    ...change
  })))
};

const markdown = [
  '# Season Availability Integration Report', '',
  `- Accepted: **${output.accepted ? 'PASS' : 'FAIL'}**`,
  `- Season harness: \`${output.season_version}\``,
  `- Fixtures: ${output.fixture_count}`,
  `- Availability changes: ${output.metrics.availability_changes}`,
  `- Injury absences: ${output.metrics.injury_absences}`,
  `- Suspension absences: ${output.metrics.suspension_absences}`,
  `- Ineligible selections: ${output.metrics.unavailable_selections}`,
  '', '## Checks', '',
  ...Object.entries(output.checks).map(([key, value]) => `- ${key}: **${value ? 'PASS' : 'FAIL'}**`),
  '', '## Absence rows', '',
  ...output.absence_rows.map((row) => `- MD${row.matchday}: ${row.player_id} — ${row.kind} until MD${row.until_matchday}`),
  ''
].join('\n');

const directory = new URL('../calibration/generated/', import.meta.url);
await mkdir(directory, { recursive: true });
await writeFile(new URL('season-availability-integration.json', directory), `${JSON.stringify(output, null, 2)}\n`);
await writeFile(new URL('season-availability-integration.md', directory), markdown);
console.log(JSON.stringify({ accepted: output.accepted, metrics: output.metrics }, null, 2));
