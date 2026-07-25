import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  alignCanonicalFixtureKickoffs,
  canonicalMatchdayKickoffs,
  nextCanonicalTurn
} from '../src/world/canonicalTurnCalendar.js';
import { projectManagerPortal } from '../src/world/managerPortalProjection.js';

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('canonical calendar alternates Tuesday and Friday production turns', () => {
  assert.equal(nextCanonicalTurn('2026-07-28T20:00:00.000Z'), '2026-07-31T20:00:00.000Z');
  assert.equal(nextCanonicalTurn('2026-07-31T20:00:00.000Z'), '2026-08-04T20:00:00.000Z');
  const rows = canonicalMatchdayKickoffs({
    firstMatchday: 2,
    firstKickoffAt: '2026-07-28T20:00:00.000Z',
    secondKickoffAt: '2026-07-31T20:00:00.000Z',
    lastMatchday: 5
  });
  assert.deepEqual([...rows.entries()], [
    [2, '2026-07-28T20:00:00.000Z'],
    [3, '2026-07-31T20:00:00.000Z'],
    [4, '2026-08-04T20:00:00.000Z'],
    [5, '2026-08-07T20:00:00.000Z']
  ]);
});

test('canonical calendar honours a configured Monday and Thursday 18:00 cadence', () => {
  const rows = canonicalMatchdayKickoffs({
    firstMatchday: 2,
    firstKickoffAt: '2026-07-27T18:00:00.000Z',
    lastMatchday: 5,
    weekdaysUtc: [1, 4],
    hourUtc: 18
  });
  assert.deepEqual([...rows.entries()], [
    [2, '2026-07-27T18:00:00.000Z'],
    [3, '2026-07-30T18:00:00.000Z'],
    [4, '2026-08-03T18:00:00.000Z'],
    [5, '2026-08-06T18:00:00.000Z']
  ]);
});

test('calendar repair preserves completed fixtures and realigns only current and future matchdays', () => {
  const world = {
    matchday_cycle: {
      current_matchday: 2,
      maximum_matchday: 4,
      runtimes: {
        d1: {
          fixtures: [
            { matchday: 1, kickoff_at: '2026-08-01T00:00:00.000Z' },
            { matchday: 2, kickoff_at: '2026-08-08T00:00:00.000Z' },
            { matchday: 3, kickoff_at: '2026-08-15T00:00:00.000Z' },
            { matchday: 4, kickoff_at: '2026-08-22T00:00:00.000Z' }
          ]
        }
      }
    }
  };
  alignCanonicalFixtureKickoffs(world, {
    currentTurnAt: '2026-07-28T20:00:00.000Z',
    nextTurnAt: '2026-07-31T20:00:00.000Z'
  });
  assert.deepEqual(world.matchday_cycle.runtimes.d1.fixtures.map((row) => row.kickoff_at), [
    '2026-08-01T00:00:00.000Z',
    '2026-07-28T20:00:00.000Z',
    '2026-07-31T20:00:00.000Z',
    '2026-08-04T20:00:00.000Z'
  ]);
});

function portalWorld() {
  const fixtures = [
    { fixture_id: 'md1', matchday: 1, kickoff_at: '2026-08-01T00:00:00.000Z', home_club_id: 'real-madrid', away_club_id: 'fenerbahce' },
    { fixture_id: 'md2', matchday: 2, kickoff_at: '2026-08-08T00:00:00.000Z', home_club_id: 'newcastle', away_club_id: 'real-madrid' },
    { fixture_id: 'md3', matchday: 3, kickoff_at: '2026-08-15T00:00:00.000Z', home_club_id: 'real-madrid', away_club_id: 'arsenal' }
  ];
  return {
    world_id: 'world', season_number: 1, phase: 'season',
    club_profiles: {
      'real-madrid': { club_id: 'real-madrid', club_name: 'Real Madrid' },
      fenerbahce: { club_id: 'fenerbahce', club_name: 'Fenerbahce' },
      newcastle: { club_id: 'newcastle', club_name: 'Newcastle United' },
      arsenal: { club_id: 'arsenal', club_name: 'Arsenal' }
    },
    competition: { divisions: [{ division_id: 'd1', level: 1, club_ids: ['real-madrid', 'fenerbahce', 'newcastle', 'arsenal'] }] },
    squad_cycle: {
      season_id: 'world:season-1', registration_limit: 25,
      clubs: { 'real-madrid': { club_id: 'real-madrid', player_ids: [], registered_player_ids: [] } },
      players: {}, contracts: {}, state: { registrations: {} }
    },
    matchday_cycle: {
      current_matchday: 2,
      maximum_matchday: 3,
      runtimes: {
        d1: {
          fixtures,
          results: [{ fixture: fixtures[0], score: { home: 2, away: 0 } }],
          table: { 'real-madrid': { club_id: 'real-madrid', played: 1, won: 1, drawn: 0, lost: 0, gf: 2, ga: 0, gd: 2, points: 3 } },
          state: { players: {}, availability: { players: {} } }
        }
      }
    }
  };
}

test('portal schedule projects the current canonical deadline and twice-weekly future dates', () => {
  const projection = projectManagerPortal(portalWorld(), 'real-madrid', { nextTurnAt: '2026-07-28T20:00:00.000Z' });
  assert.equal(projection.next_fixture.kickoff_at, '2026-07-28T20:00:00.000Z');
  assert.equal(projection.fixtures.find((row) => row.matchday === 3).kickoff_at, '2026-07-31T20:00:00.000Z');
  assert.equal(projection.fixtures.find((row) => row.matchday === 1).kickoff_at, '2026-08-01T00:00:00.000Z');
});

test('portal schedule uses the configured cadence for future matchdays', () => {
  const projection = projectManagerPortal(portalWorld(), 'real-madrid', {
    nextTurnAt: '2026-07-27T18:00:00.000Z',
    weekdaysUtc: [1, 4],
    hourUtc: 18
  });
  assert.equal(projection.next_fixture.kickoff_at, '2026-07-27T18:00:00.000Z');
  assert.equal(projection.fixtures.find((row) => row.matchday === 3).kickoff_at, '2026-07-30T18:00:00.000Z');
});

test('scheduler persists repaired dates and dashboard exposes a live kickoff countdown', async () => {
  const [scheduler, bootstrap, model, portal] = await Promise.all([
    source('src/world/sharedWorldScheduler.js'),
    source('netlify/functions/bootstrap.mjs'),
    source('public/portal-v1-model.js'),
    source('public/portal-v1.js')
  ]);
  assert.match(scheduler, /alignCanonicalFixtureKickoffs\(world/);
  assert.match(scheduler, /currentTurnAt: plan\.scheduled_for/);
  assert.match(scheduler, /currentTurnAt: plan\.next_turn_at/);
  assert.match(scheduler, /turn_calendar: configuredTurnCalendar/);
  assert.match(scheduler, /weekdaysUtc: cadence\.weekdays_utc/);
  assert.match(scheduler, /hourUtc: cadence\.hour_utc/);
  assert.match(bootstrap, /projectManagerPortal\(world, appointment\.club_id, \{/);
  assert.match(bootstrap, /weekdaysUtc: TURN_DAYS/);
  assert.match(bootstrap, /hourUtc: TURN_HOUR_UTC/);
  assert.match(model, /next_kickoff_at/);
  assert.match(portal, /until kick-off/);
  assert.match(portal, /Intl\.DateTimeFormat\('en-GB'/);
});
