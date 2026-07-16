import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEngineMatchContract } from '../src/engineBridge.js';
import { simulateMatch } from '../src/matchSimulation.js';

const players = Array.from({ length: 22 }, (_, index) => ({
  tbg_player_id: `p-${index + 1}`,
  underlying_ability_rating: index < 11 ? 90 : 88,
  position_group: index % 11 === 0 ? 'GK' : index % 3 === 0 ? 'ATT' : 'MID'
}));
const fixture = { id: 'f-1', world_id: 'tbg-world-1', season_id: 'season-1', home_club_id: 'c-1', away_club_id: 'c-2', competition_id: 'division-1', matchday: 1, kickoff_at: '2026-07-16T17:00:00Z' };
const submission = (clubId, ids) => ({ id: `s-${clubId}`, club_id: clubId, status: 'locked', version: 1, formation: '4-3-3-wide', starting_xi: ids, bench: [], tactics: { mentality: 'balanced', pressing: 'mid', tempo: 'normal', width: 'balanced', defensive_line: 'standard' } });
const submissions = [submission('c-1', players.slice(0, 11).map((p) => p.tbg_player_id)), submission('c-2', players.slice(11).map((p) => p.tbg_player_id))];
const world = { world_id: 'tbg-world-001', active_season_id: 'season-001', generated_at: 'build-1', players };

test('normalises snapshot IDs to fixture IDs while retaining source IDs', () => {
  const contract = buildEngineMatchContract({ fixture, submissions, world });
  assert.equal(contract.fixture.world_id, 'tbg-world-1');
  assert.equal(contract.world_snapshot.world_id, 'tbg-world-1');
  assert.equal(contract.world_snapshot.source_world_id, 'tbg-world-001');
  assert.equal(contract.fixture.season_id, 'season-1');
  assert.equal(contract.world_snapshot.season_id, 'season-1');
});

test('produces a deterministic completed result contract', () => {
  const contract = buildEngineMatchContract({ fixture, submissions, world });
  const first = simulateMatch(contract, world);
  const second = simulateMatch(contract, world);
  assert.deepEqual(first.score, second.score);
  assert.deepEqual(first.events.map(({ played_at, ...event }) => event), second.events.map(({ played_at, ...event }) => event));
  assert.equal(first.status, 'completed');
  assert.equal(first.result_version, '2d2-v1');
  assert.ok(Number.isInteger(first.score.home));
  assert.ok(Number.isInteger(first.score.away));
});
