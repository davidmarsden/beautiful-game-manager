import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { canonicalFixtureIds, projectManagerPortal } from '../src/world/managerPortalProjection.js';

function canonicalWorld({ scheduled = false, played = false } = {}) {
  const fixtures = scheduled ? [
    { fixture_id: 'canonical-world:season-1:d1:fixture-001', matchday: 1, kickoff_at: '2026-08-08T15:00:00.000Z', home_club_id: 'tbg-club-001', away_club_id: 'tbg-club-002' },
    { fixture_id: 'canonical-world:season-1:d1:fixture-002', matchday: 2, kickoff_at: '2026-08-15T15:00:00.000Z', home_club_id: 'tbg-club-002', away_club_id: 'tbg-club-001' }
  ] : [];
  const results = played ? [{
    fixture: { ...fixtures[0] },
    score: { home: 2, away: 1 },
    outcome: 'home_win',
    statistics: {},
    events: [],
    teams: {}
  }] : [];
  return {
    version: 'tbg-playable-persistent-world-v1.0',
    world_id: 'canonical-world',
    display_name: 'The Beautiful Game',
    season_number: 1,
    phase: scheduled ? 'season' : 'preseason',
    clock: '2026-08-01T00:00:00.000Z',
    human_club_id: 'tbg-club-001',
    club_profiles: {
      'tbg-club-001': { club_id: 'tbg-club-001', club_name: 'Southall Athletic', formation: '4-3-3-wide', tactics: {} },
      'tbg-club-002': { club_id: 'tbg-club-002', club_name: 'Ealing United', formation: '4-4-2', tactics: {} }
    },
    squad_cycle: {
      season_id: 'canonical-world:season-1',
      registration_limit: 25,
      clubs: {
        'tbg-club-001': { club_id: 'tbg-club-001', player_ids: ['player-1'], registered_player_ids: ['player-1'] },
        'tbg-club-002': { club_id: 'tbg-club-002', player_ids: ['player-2'], registered_player_ids: ['player-2'] }
      },
      players: {
        'player-1': { tbg_player_id: 'player-1', display_name: 'Canonical One', club_id: 'tbg-club-001', age: 24, underlying_ability_rating: 90, registered: true },
        'player-2': { tbg_player_id: 'player-2', display_name: 'Canonical Two', club_id: 'tbg-club-002', age: 25, underlying_ability_rating: 89, registered: true }
      },
      contracts: {},
      state: { registrations: { 'player-1': { registered: true }, 'player-2': { registered: true } } }
    },
    competition: {
      divisions: [{ division_id: 'd1', level: 1, club_ids: ['tbg-club-001', 'tbg-club-002'] }]
    },
    ...(scheduled ? {
      matchday_cycle: {
        season_id: 'canonical-world:season-1',
        current_matchday: played ? 2 : 1,
        maximum_matchday: 2,
        runtimes: {
          d1: {
            fixtures,
            results,
            table: {
              'tbg-club-001': { club_id: 'tbg-club-001', played: played ? 1 : 0, won: played ? 1 : 0, drawn: 0, lost: 0, gf: played ? 2 : 0, ga: played ? 1 : 0, gd: played ? 1 : 0, points: played ? 3 : 0 },
              'tbg-club-002': { club_id: 'tbg-club-002', played: played ? 1 : 0, won: 0, drawn: 0, lost: played ? 1 : 0, gf: played ? 1 : 0, ga: played ? 2 : 0, gd: played ? -1 : 0, points: 0 }
            },
            state: {
              players: { 'player-1': { fitness: 97, morale: 55 }, 'player-2': { fitness: 95, morale: 49 } },
              availability: { players: {} }
            }
          }
        }
      }
    } : {})
  };
}

test('canonical preseason exposes no invented fixture, result or table state', () => {
  const projection = projectManagerPortal(canonicalWorld(), 'tbg-club-001');
  assert.equal(projection.club.canonical_name, 'Southall Athletic');
  assert.equal(projection.club.division_name, 'Division 1');
  assert.equal(projection.preseason, true);
  assert.equal(projection.next_fixture, null);
  assert.equal(projection.last_fixture, null);
  assert.deepEqual(projection.fixture_history, []);
  assert.deepEqual(projection.competition.standings, []);
  assert.match(projection.world.status, /fixtures have not been generated/i);
  assert.doesNotMatch(JSON.stringify(projection), /Demo FC|Sample United|tbg-club-001-style/i);
});

test('canonical schedule resolves the next opponent to its public club identity', () => {
  const world = canonicalWorld({ scheduled: true });
  const projection = projectManagerPortal(world, 'tbg-club-001');
  assert.equal(projection.preseason, false);
  assert.equal(projection.next_fixture.fixture_id, 'canonical-world:season-1:d1:fixture-001');
  assert.equal(projection.next_fixture.opponent_name, 'Ealing United');
  assert.equal(projection.next_fixture.venue, 'home');
  assert.equal(projection.next_fixture.competition, 'Division 1');
  assert.equal(canonicalFixtureIds(world).has(projection.next_fixture.fixture_id), true);
});

test('canonical results, standings and next fixture remain in one season state', () => {
  const projection = projectManagerPortal(canonicalWorld({ scheduled: true, played: true }), 'tbg-club-001');
  assert.equal(projection.world.season_id, 'canonical-world:season-1');
  assert.equal(projection.competition.season_id, projection.world.season_id);
  assert.equal(projection.last_fixture.opponent_name, 'Ealing United');
  assert.equal(projection.last_fixture.own_score, 2);
  assert.equal(projection.last_fixture.opponent_score, 1);
  assert.equal(projection.next_fixture.fixture_id, 'canonical-world:season-1:d1:fixture-002');
  assert.equal(projection.competition.standings[0].club_name, 'Southall Athletic');
  assert.equal(projection.competition.standings[1].club_name, 'Ealing United');
});

test('portal registration follows live squad-cycle registration rather than stale player data', () => {
  const world = canonicalWorld();
  world.squad_cycle.clubs['tbg-club-001'].registered_player_ids = [];
  world.squad_cycle.state.registrations['player-1'] = { registered: false };
  world.squad_cycle.players['player-1'].registered = true;
  const projection = projectManagerPortal(world, 'tbg-club-001');
  assert.equal(projection.squad[0].registered, false);
  assert.equal(projection.squad[0].registration_status, 'unregistered');
  assert.deepEqual(projection.club.squad.registered_player_ids, []);
});

test('production bootstrap cannot read legacy publication, fixture or standings state', async () => {
  const source = await readFile(new URL('../netlify/functions/bootstrap.mjs', import.meta.url), 'utf8');
  assert.match(source, /canonical_world_saves/);
  assert.match(source, /projectManagerPortal\(world, appointment\.club_id\)/);
  assert.match(source, /canonicalFixtureIds\(world\)/);
  assert.match(source, /manager_turn_submissions/);
  assert.match(source, /matchday=eq\.\$\{currentMatchday\}/);
  assert.doesNotMatch(source, /TBG_WORLD_URL|WORLD_URL/);
  assert.doesNotMatch(source, /\/rest\/v1\/fixtures/);
  assert.doesNotMatch(source, /competition_standings/);
  assert.doesNotMatch(source, /manager_match_views/);
  assert.doesNotMatch(source, /\/rest\/v1\/manager_submissions/);
});

test('team decisions are persisted through the canonical turn ledger', async () => {
  const source = await readFile(new URL('../netlify/functions/decisions.mjs', import.meta.url), 'utf8');
  assert.match(source, /canonical_world_saves/);
  assert.match(source, /buildManagerTurnSubmission/);
  assert.match(source, /manager_turn_submissions\?on_conflict=world_id,season_id,matchday,club_id/);
  assert.match(source, /Fixture is not the canonical next fixture/);
  assert.doesNotMatch(source, /TBG_WORLD_URL|WORLD_URL/);
  assert.doesNotMatch(source, /\/rest\/v1\/fixtures/);
  assert.doesNotMatch(source, /\/rest\/v1\/manager_submissions/);
});

test('world view resolves the appointed club name rather than displaying its internal ID', async () => {
  const source = await readFile(new URL('../netlify/functions/shared-world.mjs', import.meta.url), 'utf8');
  const display = await readFile(new URL('../public/canonical-display.js', import.meta.url), 'utf8');
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(source, /club_name: projection\.club\.canonical_name/);
  assert.match(source, /appointment = \{ \.\.\.current\.appointment, club_name: summary\.club_name/);
  assert.doesNotMatch(source, /portalWorldSummary/);
  assert.match(display, /strong\.textContent = clubName/);
  assert.match(display, /Preseason — fixtures have not been generated yet/);
  assert.match(html, /src="\.\/canonical-display\.js"/);
  assert.doesNotMatch(html, /inaugural 38-match schedule/i);
});
