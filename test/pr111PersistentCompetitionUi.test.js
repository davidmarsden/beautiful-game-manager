import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { projectManagerPortal } from '../src/world/managerPortalProjection.js';

function world() {
  const fixtures = [
    { fixture_id: 'world:season-1:d1:md1', matchday: 1, kickoff_at: '2026-07-25T15:00:00.000Z', home_club_id: 'real-madrid', away_club_id: 'arsenal' },
    { fixture_id: 'world:season-1:d1:md2', matchday: 2, kickoff_at: '2026-07-28T20:00:00.000Z', home_club_id: 'newcastle', away_club_id: 'real-madrid' }
  ];
  return {
    world_id: 'world', display_name: 'The Beautiful Game', season_number: 1, phase: 'season',
    club_profiles: {
      'real-madrid': { club_id: 'real-madrid', club_name: 'Real Madrid' },
      arsenal: { club_id: 'arsenal', club_name: 'Arsenal' },
      newcastle: { club_id: 'newcastle', club_name: 'Newcastle United' }
    },
    squad_cycle: {
      season_id: 'world:season-1', registration_limit: 25,
      clubs: {
        'real-madrid': { club_id: 'real-madrid', player_ids: [], registered_player_ids: [] },
        arsenal: { club_id: 'arsenal', player_ids: [], registered_player_ids: [] },
        newcastle: { club_id: 'newcastle', player_ids: [], registered_player_ids: [] }
      },
      players: {}, contracts: {}, state: { registrations: {} }
    },
    competition: { divisions: [{ division_id: 'd1', level: 1, club_ids: ['real-madrid', 'arsenal', 'newcastle'] }] },
    matchday_cycle: {
      current_matchday: 2, maximum_matchday: 38,
      runtimes: {
        d1: {
          fixtures,
          results: [{ fixture: fixtures[0], score: { home: 2, away: 0 }, events: [], statistics: {}, teams: {} }],
          table: {
            'real-madrid': { club_id: 'real-madrid', played: 1, won: 1, drawn: 0, lost: 0, gf: 2, ga: 0, gd: 2, points: 3 },
            arsenal: { club_id: 'arsenal', played: 1, won: 0, drawn: 0, lost: 1, gf: 0, ga: 2, gd: -2, points: 0 },
            newcastle: { club_id: 'newcastle', played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, gd: 0, points: 0 }
          },
          state: { players: {}, availability: { players: {} } }
        }
      }
    }
  };
}

test('portal projection exposes full canonical schedule and complete standings fields', () => {
  const projection = projectManagerPortal(world(), 'real-madrid');
  assert.equal(projection.fixtures.length, 2);
  assert.equal(projection.season.fixture_count, 2);
  assert.equal(projection.fixtures[0].opponent_name, 'Arsenal');
  assert.equal(projection.fixtures[0].status, 'played');
  assert.equal(projection.fixtures[1].opponent_name, 'Newcastle United');
  assert.equal(projection.fixtures[1].status, 'scheduled');
  const madrid = projection.competition.standings.find((row) => row.club_id === 'real-madrid');
  assert.equal(madrid.goals_for, 2);
  assert.equal(madrid.goals_against, 0);
  assert.equal(madrid.goal_difference, 2);
  assert.deepEqual(madrid.form, ['W']);
});

test('canonical match centre reads persisted world rather than legacy fixture tables', async () => {
  const source = await readFile(new URL('../netlify/functions/match-centre.mjs', import.meta.url), 'utf8');
  assert.match(source, /canonical_world_saves/);
  assert.match(source, /loadPersistentWorld/);
  assert.match(source, /canonicalFixture\(world, fixtureId\)/);
  assert.match(source, /result\.events/);
  assert.doesNotMatch(source, /\/rest\/v1\/fixtures\?id=eq\./);
  assert.doesNotMatch(source, /TBG_WORLD_URL|WORLD_URL/);
});

test('canonical match centre reads singular persisted instruction payloads', async () => {
  const source = await readFile(new URL('../netlify/functions/match-centre.mjs', import.meta.url), 'utf8');
  assert.match(source, /submission\.instruction \|\| submission\.instructions \|\| \{\}/);
  assert.match(source, /instruction\.starting_xi/);
  assert.match(source, /instruction\.bench/);
  assert.match(source, /instruction\.formation/);
  assert.match(source, /instruction\.captain_id/);
});

test('canonical match centre maps embedded fallback teams by fixture side', async () => {
  const source = await readFile(new URL('../netlify/functions/match-centre.mjs', import.meta.url), 'utf8');
  assert.match(source, /clubId === fixture\.home_club_id \? 'home'/);
  assert.match(source, /clubId === fixture\.away_club_id \? 'away'/);
  assert.match(source, /result\.teams\?\.\[side\]/);
  assert.match(source, /club_id: clubId/);
  assert.match(source, /deterministic_fallback/);
});

test('competition UI renders full schedule and supports canonical match-report links', async () => {
  const source = await readFile(new URL('../public/phase2d3.js', import.meta.url), 'utf8');
  assert.match(source, /function renderSchedule/);
  assert.match(source, /data\.fixtures \|\| data\.schedule \|\| data\.competition\?\.fixtures/);
  assert.match(source, /goals_for \?\? row\.gf/);
  assert.match(source, /data-match-centre/);
});