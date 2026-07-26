import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  completedMatchdayKickoff,
  repairCompletedFixtureKickoffs
} from '../src/world/canonicalTurnCalendar.js';
import { projectManagerPortal } from '../src/world/managerPortalProjection.js';

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

function completedWorld() {
  const fixture = {
    fixture_id: 'world:season-1:d1:fixture-001',
    matchday: 1,
    kickoff_at: '2026-08-01T20:00:00.000Z',
    home_club_id: 'real-madrid',
    away_club_id: 'fenerbahce'
  };
  const result = {
    fixture: { ...fixture },
    score: { home: 2, away: 0 },
    events: [],
    teams: {}
  };
  return {
    world_id: 'world',
    display_name: 'The Beautiful Game',
    season_number: 1,
    phase: 'season',
    shared_turn_history: [{
      season_id: 'world:season-1',
      matchday: 1,
      scheduled_for: '2026-07-25T13:13:02.000Z'
    }],
    club_profiles: {
      'real-madrid': { club_id: 'real-madrid', club_name: 'Real Madrid' },
      fenerbahce: { club_id: 'fenerbahce', club_name: 'Fenerbahce' }
    },
    competition: { divisions: [{ division_id: 'd1', level: 1, club_ids: ['real-madrid', 'fenerbahce'] }] },
    squad_cycle: {
      season_id: 'world:season-1',
      registration_limit: 25,
      clubs: {
        'real-madrid': { club_id: 'real-madrid', player_ids: [], registered_player_ids: [] },
        fenerbahce: { club_id: 'fenerbahce', player_ids: [], registered_player_ids: [] }
      },
      players: {}, contracts: {}, state: { registrations: {} }
    },
    matchday_cycle: {
      season_id: 'world:season-1',
      current_matchday: 2,
      maximum_matchday: 1,
      runtimes: {
        d1: {
          fixtures: [fixture],
          results: [result],
          table: {
            'real-madrid': { club_id: 'real-madrid', played: 1, won: 1, drawn: 0, lost: 0, gf: 2, ga: 0, gd: 2, points: 3 },
            fenerbahce: { club_id: 'fenerbahce', played: 1, won: 0, drawn: 0, lost: 1, gf: 0, ga: 2, gd: -2, points: 0 }
          },
          state: { players: {}, availability: { players: {} } }
        }
      }
    }
  };
}

test('completed matchday date is recovered from canonical turn history', () => {
  const world = completedWorld();
  assert.equal(completedMatchdayKickoff(world, 1), '2026-07-25T13:13:02.000Z');
  repairCompletedFixtureKickoffs(world);
  assert.equal(world.matchday_cycle.runtimes.d1.fixtures[0].kickoff_at, '2026-07-25T13:13:02.000Z');
  assert.equal(world.matchday_cycle.runtimes.d1.results[0].fixture.kickoff_at, '2026-07-25T13:13:02.000Z');
});

test('portal uses the repaired completed date in schedule, last fixture and competition result', () => {
  const projection = projectManagerPortal(completedWorld(), 'real-madrid');
  assert.equal(projection.schedule[0].kickoff_at, '2026-07-25T13:13:02.000Z');
  assert.equal(projection.last_fixture.played_at, '2026-07-25T13:13:02.000Z');
  assert.equal(projection.competition.results[0].played_at, '2026-07-25T13:13:02.000Z');
});

test('completed matches always open spoiler-safe and reveal only after replay or skip', async () => {
  const [endpoint, reveal, client] = await Promise.all([
    source('netlify/functions/match-centre.mjs'),
    source('netlify/functions/reveal-match.mjs'),
    source('public/phase2d4.js')
  ]);
  assert.match(endpoint, /revealed: false/);
  assert.match(endpoint, /reveal: null/);
  assert.doesNotMatch(reveal, /manager_match_views|\/rest\/v1\/fixtures/);
  assert.match(reveal, /canonicalPlayedFixture/);
  assert.match(client, /renderMatchCentre\(\{ \.\.\.data, revealed: true/);
  assert.match(client, /finish\('replay_completed'\)/);
  assert.match(client, /finish\('skip_to_full_time'\)/);
  assert.match(client, /headerReplayScore">0-0/);
});

test('portal bootstrap suppresses completed scores before replay reveal', async () => {
  const bootstrap = await source('netlify/functions/bootstrap.mjs');
  assert.match(bootstrap, /function hideCompletedScore/);
  assert.match(bootstrap, /home_score: null/);
  assert.match(bootstrap, /opponent_score: null/);
  assert.match(bootstrap, /result_revealed: false/);
  assert.match(bootstrap, /spoilerSafeProjection\(projectManagerPortal/);
});

test('schedule keeps completed scores visible while spoiler surfaces stay hidden', async () => {
  const [bootstrap, competition] = await Promise.all([
    source('netlify/functions/bootstrap.mjs'),
    source('public/phase2d3.js')
  ]);
  assert.match(bootstrap, /schedule: projection\.schedule \|\| \[\]/);
  assert.doesNotMatch(bootstrap, /const schedule = \(projection\.schedule \|\| \[\]\)\.map\(hideCompletedScore\)/);
  assert.match(competition, /renderSchedule\(data\.schedule \|\| data\.fixtures/);
  assert.match(competition, /const scoreKnown = played && hasScore\(fixture\)/);
});

test('anonymous events are not assigned to invented line-up players', async () => {
  const endpoint = await source('netlify/functions/match-centre.mjs');
  assert.match(endpoint, /const eventPlayerId = \(event\)/);
  assert.match(endpoint, /function resolvePlayerName/);
  assert.match(endpoint, /if \(!id\) return 'Unknown player'/);
  assert.doesNotMatch(endpoint, /\(Number\(event\.minute \|\| 0\) \+ index\) % ids\.length/);
});

test('canonical event type is normalized for replay scoring and full time', async () => {
  const endpoint = await source('netlify/functions/match-centre.mjs');
  const client = await source('public/phase2d4.js');
  assert.match(endpoint, /const eventType = \(event\) => text\(event\.event_type \|\| event\.type/);
  assert.match(endpoint, /event_type: eventType\(event\) \|\| 'event'/);
  assert.match(client, /normalType\(event\.event_type\) === 'goal'/);
  assert.match(client, /normalType\(event\.event_type\) === 'full_time'/);
});

test('scheduled execution persists repaired completed dates before advancing', async () => {
  const scheduler = await source('src/world/sharedWorldScheduler.js');
  const repairIndex = scheduler.indexOf('repairCompletedFixtureKickoffs(world)');
  const advanceIndex = scheduler.indexOf('advancePersistentMatchday(world');
  assert.ok(repairIndex > -1 && advanceIndex > repairIndex);
});
