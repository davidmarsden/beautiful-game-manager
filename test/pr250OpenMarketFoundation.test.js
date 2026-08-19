import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createSquadCycleState } from '../src/squadCycle/squadCycle.js';
import { acquireFreeAgent } from '../src/squadCycle/freeAgentAcquisition.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

function world() {
  return createSquadCycleState({
    seasonId: 's1',
    seasonStart: '2026-08-01T00:00:00.000Z',
    seasonEnd: '2027-06-30T23:59:59.000Z',
    clubs: [
      { club_id: 'a', players: [] },
      { club_id: 'b', players: [] }
    ]
  });
}

test('free-agent acquisition creates identity, contract, registration and audit event', () => {
  const state = world();
  const result = acquireFreeAgent(state, {
    toClubId: 'a',
    at: '2026-08-10T12:00:00.000Z',
    player: {
      tbg_player_id: 'tbg-tm-00123456',
      transfermarkt_id: '123456',
      display_name: 'Unsigned Prospect',
      age: 20,
      underlying_ability_rating: 79
    }
  });
  assert.equal(result.player.club_id, 'a');
  assert.equal(state.clubs.a.player_ids.includes('tbg-tm-00123456'), true);
  assert.equal(state.clubs.a.registered_player_ids.includes('tbg-tm-00123456'), true);
  assert.equal(result.contract.club_id, 'a');
  assert.equal(state.events.at(-1).type, 'free_agent_signed');
  assert.equal(state.events.at(-1).transfermarkt_id, '123456');
});

test('free-agent acquisition rejects duplicate canonical identities before mutation', () => {
  const state = world();
  const player = { tbg_player_id: 'tbg-tm-00123456', transfermarkt_id: '123456', display_name: 'Unsigned Prospect', age: 20 };
  acquireFreeAgent(state, { toClubId: 'a', at: '2026-08-10T12:00:00.000Z', player });
  const before = JSON.stringify(state);
  assert.throws(() => acquireFreeAgent(state, { toClubId: 'b', at: '2026-08-10T12:00:00.000Z', player }), /already exists in the world/);
  assert.equal(JSON.stringify(state), before);
});

test('free-agent acquisition respects split squad capacity before identity creation', () => {
  const seniorPlayers = Array.from({ length: 25 }, (_, index) => ({
    tbg_player_id: `senior-${index}`,
    display_name: `Senior ${index}`,
    age: 25,
    underlying_ability_rating: 75
  }));
  const state = createSquadCycleState({
    seasonId: 's1',
    seasonStart: '2026-08-01T00:00:00.000Z',
    seasonEnd: '2027-06-30T23:59:59.000Z',
    clubs: [{ club_id: 'a', players: seniorPlayers }, { club_id: 'b', players: [] }]
  });
  assert.throws(() => acquireFreeAgent(state, {
    toClubId: 'a', at: '2026-08-10T12:00:00.000Z',
    player: { tbg_player_id: 'new-senior', display_name: 'New Senior', age: 26 }
  }), /first-team squad limit reached \(25\)/);
  assert.equal(state.players['new-senior'], undefined);
});

test('free-agent endpoint uses the governed unsigned-player pool and supports TM-ID exact lookup', async () => {
  const source = await read('netlify/functions/free-agents.mjs');
  assert.match(source, /derived\/tbg-player-pools\/unsigned-players\.json/);
  assert.match(source, /assignment_status === 'unsigned'/);
  assert.match(source, /url\.searchParams\.get\('tm_id'\)/);
  assert.match(source, /external_import_required: true/);
  assert.match(source, /transfermarkt_id/);
});
