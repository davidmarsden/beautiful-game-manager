import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { projectPersistentHistory } from '../src/world/persistentHistoryProjection.js';

test('history navigation installs a visible History tab', () => {
  const source = fs.readFileSync(new URL('../public/portal-navigation.js', import.meta.url), 'utf8');
  assert.match(source, /tabs\.querySelector\('\[data-view="history"\]'\)/);
  assert.match(source, /button\.textContent = 'History'/);
});

test('history projection exposes all club squads for drill-down', () => {
  const world = {
    world_id: 'w',
    season_number: 1,
    club_profiles: { a: { club_name: 'Alpha', country: 'England' }, b: { club_name: 'Beta' } },
    competition: { divisions: [{ division_id: 'd1', level: 1, club_ids: ['a', 'b'] }], movement_history: [] },
    matchday_cycle: { runtimes: { d1: { table: {}, results: [], fixtures: [] } } },
    squad_cycle: {
      season_id: 'w:season-1',
      clubs: { a: { player_ids: ['p1'], registered_player_ids: ['p1'] }, b: { player_ids: [] } },
      players: { p1: { display_name: 'Player One', position: 'CM', age: 24, underlying_ability_rating: 88 } }
    },
    history: { archives: [] },
    completed_seasons: []
  };
  const result = projectPersistentHistory(world);
  assert.equal(result.clubs.a.club_name, 'Alpha');
  assert.equal(result.clubs.a.players[0].display_name, 'Player One');
  assert.equal(result.clubs.a.players[0].rating, 88);
});

test('history UI makes club rows clickable', () => {
  const source = fs.readFileSync(new URL('../public/history.js', import.meta.url), 'utf8');
  assert.match(source, /data-club-id/);
  assert.match(source, /historyClubPanel/);
  assert.match(source, /Click any club to view its squad/);
});
