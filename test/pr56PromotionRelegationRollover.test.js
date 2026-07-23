import test from 'node:test';
import assert from 'node:assert/strict';
import { simulateCompleteLeagueStructure, syntheticPlayableLeagueStructure } from '../src/matchEngine/leagueStructureSimulation.js';
import { rollOverPlayableLeague } from '../src/matchEngine/seasonRollover.js';

function completedSeason() {
  const divisions = syntheticPlayableLeagueStructure({ clubsPerDivision: 4 });
  const report = simulateCompleteLeagueStructure({
    divisions,
    seasonId: 'pr56-season-one',
    startAt: '2026-08-01T15:00:00.000Z'
  });
  return { divisions, report };
}

test('promotion and relegation produce a complete balanced next-season structure', () => {
  const { divisions, report } = completedSeason();
  const rollover = rollOverPlayableLeague({ divisions, completedReport: report, movementCount: 1, nextSeasonId: 'pr56-season-two' });

  assert.equal(rollover.accepted, true, JSON.stringify(rollover.checks, null, 2));
  assert.equal(rollover.next_season_id, 'pr56-season-two');
  assert.equal(rollover.divisions.length, 5);
  assert.equal(rollover.movements.length, 8);
  assert.ok(rollover.divisions.every((division) => division.club_count === 4));
  assert.equal(rollover.checks.contiguous_division_set_preserved, true);
  assert.equal(rollover.checks.report_divisions_match_supplied_divisions, true);

  const originalIds = divisions.flatMap((division) => division.clubs.map((club) => club.club_id)).sort();
  const nextIds = rollover.divisions.flatMap((division) => division.clubs.map((club) => club.club_id)).sort();
  assert.deepEqual(nextIds, originalIds);

  for (let index = 0; index < report.divisions.length - 1; index += 1) {
    const upper = report.divisions[index];
    const lower = report.divisions[index + 1];
    const relegated = upper.standings.at(-1).club_id;
    const promoted = lower.standings[0].club_id;
    assert.ok(rollover.divisions[index + 1].clubs.some((club) => club.club_id === relegated));
    assert.ok(rollover.divisions[index].clubs.some((club) => club.club_id === promoted));
  }
});

test('season rollover is deterministic for the same completed season', () => {
  const { divisions, report } = completedSeason();
  const first = rollOverPlayableLeague({ divisions, completedReport: report, movementCount: 1 });
  const second = rollOverPlayableLeague({ divisions, completedReport: report, movementCount: 1 });
  assert.deepEqual(first, second);
});

test('season rollover refuses mismatched or unaccepted structures', () => {
  const { divisions, report } = completedSeason();
  assert.throws(
    () => rollOverPlayableLeague({ divisions: divisions.slice(0, 4), completedReport: report }),
    /report divisions do not match supplied divisions/
  );
  assert.throws(
    () => rollOverPlayableLeague({ divisions, completedReport: { ...report, accepted: false } }),
    /accepted completed league report/
  );
});

test('season rollover refuses non-contiguous division levels', () => {
  const { divisions, report } = completedSeason();
  const invalidLevels = divisions.map((division) => {
    if (division.division_id === 'd2') return { ...division, level: 3 };
    if (division.division_id === 'd3') return { ...division, level: 2 };
    return division;
  });

  assert.throws(
    () => rollOverPlayableLeague({ divisions: invalidLevels, completedReport: report }),
    /contiguous divisions d1 through dN/
  );
});
