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
  assert.match(renderer, /First Team/);
  assert.match(renderer, /Youth Team/);
  assert.match(renderer, /Loaned Out/);
  assert.match(renderer, /Total Owned/);
  assert.match(renderer, /data-squad-search/);
  assert.match(renderer, /data-position-filter/);
  assert.match(renderer, /data-availability-filter/);
  assert.match(renderer, /Registration, transfers and team-selection controls are available only to the appointed manager/);
});

test('manager-safe history projection includes full squad fields, coverage and contract watch', () => {
  const world = {
    squad_cycle: {
      rules: { first_team_capacity: 25, youth_team_capacity: 20 },
      clubs: { alpha: { player_ids: ['p1', 'p2'], registered_player_ids: ['p1', 'p2'] } },
      players: {
        p1: { display_name: 'Keeper One', position: 'GK', age: 28, underlying_ability_rating: 90, fitness: 84, morale: 'Excellent', injury_status: 'Available', contract_expiry: '2026-10-01' },
        p2: { display_name: 'Young Forward', position: 'ST', age: 19, underlying_ability_rating: 72, fitness: 96, morale: 'Good', injury_status: 'Injured', transfer_listed: true }
      }
    }
  };
  const result = enrichHistorySquads({ clubs: { alpha: { club_id: 'alpha', club_name: 'Alpha' } } }, world, { now: new Date('2026-07-26T00:00:00Z') });
  const club = result.clubs.alpha;
  assert.equal(club.players.length, 2);
  assert.equal(club.players[0].fitness, 84);
  assert.equal(club.players[0].morale, 'Excellent');
  assert.equal(club.players[1].transfer_listed, true);
  assert.equal(club.squad_rules.first_team_capacity, 25);
  assert.equal(club.coverage.length, 4);
  assert.equal(club.contracts[0].player_name, 'Keeper One');
  assert.equal(Object.hasOwn(club.players[0], 'wage'), false);
  assert.equal(Object.hasOwn(club.players[0], 'manager_commands'), false);
});

test('history endpoint enriches the existing persistent history projection', () => {
  const source = read('../netlify/functions/history.mjs');
  assert.match(source, /enrichHistorySquads\(projection, world\)/);
  assert.match(source, /managedClubId: appointment\.club_id/);
});
