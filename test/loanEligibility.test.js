import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEngineMatchContract } from '../src/engineBridge.js';
import { loanEligibility } from '../src/world/loanEligibility.js';

const playerIds = Array.from({ length: 11 }, (_, index) => `p${index + 1}`);
const fixture = {
  id: 'fixture-1',
  world_id: 'world-1',
  season_id: 'season-1',
  competition_id: 'league-1',
  home_club_id: 'borrower',
  away_club_id: 'parent',
  competition_rules: { parent_club_restriction: true }
};
const world = {
  world_id: 'world-1',
  active_season_id: 'season-1',
  players: playerIds.map((id) => ({ tbg_player_id: id })),
  player_ownership: [{ tbg_player_id: 'p1', club_id: 'parent', loan: { club_id: 'borrower', status: 'loaned_out' } }]
};
const submission = (clubId, ids) => ({
  id: `submission-${clubId}`,
  club_id: clubId,
  status: 'locked',
  version: 1,
  formation: '4-3-3-wide',
  starting_xi: ids,
  bench: [],
  tactics: {}
});

test('reports parent-club fixture ineligibility deterministically', () => {
  const result = loanEligibility({ player_id: 'p1', club_id: 'borrower', fixture, world });
  assert.equal(result.eligible, false);
  assert.equal(result.reason, 'parent_club_fixture');
});

test('engine contract rejects a locked team containing a parent-club-ineligible loanee', () => {
  assert.throws(() => buildEngineMatchContract({
    fixture,
    world,
    submissions: [submission('borrower', playerIds), submission('parent', playerIds.map((id) => `parent-${id}`))]
  }), /ineligible against their parent club/);
});

test('engine contract allows the same selection when the competition disables the rule', () => {
  const openFixture = { ...fixture, competition_rules: { parent_club_restriction: false } };
  const contract = buildEngineMatchContract({
    fixture: openFixture,
    world,
    submissions: [submission('borrower', playerIds), submission('parent', playerIds.map((id) => `parent-${id}`))]
  });
  assert.equal(contract.teams.home.starting_xi[0], 'p1');
});
