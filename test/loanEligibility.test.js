import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildEngineMatchContract } from '../src/engineBridge.js';
import { findWorldFixture, loanEligibility } from '../src/world/loanEligibility.js';

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

test('resolves fixtures stored inside the canonical shared-world runtime', () => {
  const canonicalWorld = {
    ...world,
    players: undefined,
    squad_cycle: { players: Object.fromEntries(playerIds.map((id) => [id, { tbg_player_id: id }])) },
    matchday_cycle: { runtimes: { division_1: { fixtures: [fixture] } } }
  };
  assert.equal(findWorldFixture(canonicalWorld, 'fixture-1'), fixture);
  assert.equal(loanEligibility({ player_id: 'p1', club_id: 'borrower', fixture: findWorldFixture(canonicalWorld, 'fixture-1'), world: canonicalWorld }).eligible, false);
});

test('canonical decisions endpoint enforces loan eligibility before saving the turn submission', async () => {
  const source = await readFile(new URL('../netlify/functions/decisions.mjs', import.meta.url), 'utf8');
  assert.match(source, /findWorldFixture\(world, fixture\.fixture_id\)/);
  assert.match(source, /ineligibleLoanPlayerIds/);
  assert.match(source, /parent_club_fixture/);
  assert.ok(source.indexOf('ineligibleLoanPlayerIds') < source.indexOf("manager_turn_submissions?on_conflict"));
});
