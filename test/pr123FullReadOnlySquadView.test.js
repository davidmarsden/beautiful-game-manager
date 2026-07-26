import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { enrichHistorySquads } from '../src/world/historySquadProjection.js';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');

test('history club inspection uses the shared full squad renderer', () => {
  const history = read('../public/history.js');
  const renderer = read('../public/squad-view.js');
  assert.match(history, /import \{ mountReadOnlySquadView \} from '\.\/squad-view\.js'/);
  assert.match(history, /mountReadOnlySquadView\(host, club\)/);
  assert.match(history, /history-club-host/);
  assert.match(renderer, /First Team/);
  assert.match(renderer, /Youth Team/);
  assert.match(renderer, /Loaned Out/);
  assert.match(renderer, /Total Owned/);
  assert.match(renderer, /data-squad-search/);
  assert.match(renderer, /data-position-filter/);
  assert.match(renderer, /data-availability-filter/);
});

test('history projection uses canonical runtime state and registration capacity', () => {
  const world = {
    world_id: 'world-1', season_number: 1, phase: 'season',
    club_profiles: { alpha: { club_name: 'Alpha' } },
    competition: { divisions: [{ division_id: 'd1', level: 1, club_ids: ['alpha'] }] },
    matchday_cycle: {
      current_matchday: 4,
      maximum_matchday: 10,
      runtimes: { d1: { fixtures: [], results: [], table: {}, state: {
        players: { p1: { fitness: 84, morale: 'Excellent' }, p2: { fitness: 96, morale: 'Good' } },
        availability: { players: { p2: { injury_until_matchday: 6 } } }
      } } }
    },
    squad_cycle: {
      season_id: 'world-1:season-1', registration_limit: 22,
      clubs: { alpha: { player_ids: ['p1', 'p2'], registered_player_ids: ['p1', 'p2'] } },
      contracts: { c1: { end_at: '2026-10-01' } },
      players: {
        p1: { tbg_player_id: 'p1', club_id: 'alpha', contract_id: 'c1', display_name: 'Keeper One', position: 'GK', age: 28, underlying_ability_rating: 90 },
        p2: { tbg_player_id: 'p2', club_id: 'alpha', display_name: 'Young Forward', position: 'ST', age: 19, underlying_ability_rating: 72, transfer_listed: true }
      }
    }
  };
  const result = enrichHistorySquads({ clubs: { alpha: { club_id: 'alpha', club_name: 'Alpha' } } }, world, { now: new Date('2026-07-26T00:00:00Z') });
  const club = result.clubs.alpha;
  assert.equal(club.players[0].fitness, 84);
  assert.equal(club.players[0].morale, 'Excellent');
  assert.equal(club.players[0].contract_expiry, '2026-10-01');
  assert.equal(club.players[1].injury_status, 'Injured');
  assert.equal(club.squad_rules.first_team_capacity, 22);
  assert.equal(club.contracts[0].player_name, 'Keeper One');
});

test('history endpoint enriches the existing persistent history projection', () => {
  const source = read('../netlify/functions/history.mjs');
  assert.match(source, /enrichHistorySquads\(projection, world\)/);
  assert.match(source, /managedClubId: appointment\.club_id/);
});
