import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  createLoanEligibilitySnapshot,
  fixtureEligibilityCheckpoint,
  loanEligibility,
  resolveParentClubRestriction
} from '../src/world/loanEligibility.js';

const world = {
  players: [{ tbg_player_id: 'p1' }],
  player_ownership: [{
    tbg_player_id: 'p1',
    tbg_club_id: 'parent',
    loan: { status: 'loaned_out', club_id: 'borrower', start_at: '2026-07-01T00:00:00.000Z', end_at: '2026-08-31T23:59:59.000Z' }
  }],
  rules: { loans: { parent_club_restriction: true } }
};
const fixture = { id: 'f1', home_club_id: 'borrower', away_club_id: 'parent', lock_at: '2026-07-20T18:00:00.000Z', kickoff_at: '2026-07-20T20:00:00.000Z' };

test('explicit inherit continues to the world rule', () => {
  const result = resolveParentClubRestriction({ world, fixture: { ...fixture, competition_rules: { parent_club_restriction: 'inherit' } } });
  assert.equal(result.enabled, true);
  assert.equal(result.source, 'world');
});

test('explicit false competition rule overrides the world', () => {
  const result = resolveParentClubRestriction({ world, fixture: { ...fixture, competition_rules: { parent_club_restriction: false } } });
  assert.equal(result.enabled, false);
  assert.equal(result.source, 'competition');
});

test('loan dates are evaluated at the fixture lock checkpoint', () => {
  assert.deepEqual(fixtureEligibilityCheckpoint(fixture), { type: 'timestamp', value: fixture.lock_at, source: 'fixture_lock' });
  assert.equal(loanEligibility({ player_id: 'p1', club_id: 'borrower', fixture, world }).eligible, false);
  assert.equal(loanEligibility({ player_id: 'p1', club_id: 'borrower', fixture: { ...fixture, lock_at: '2026-09-01T18:00:00.000Z' }, world }).eligible, true);
});

test('snapshot records rule source, checkpoint and deterministic outcome', () => {
  const snapshot = createLoanEligibilitySnapshot({ playerIds: ['p1'], clubId: 'borrower', fixture, world });
  assert.equal(snapshot.version, 'loan-fixture-eligibility-v0.2');
  assert.equal(snapshot.rule.source, 'world');
  assert.equal(snapshot.checkpoint.value, fixture.lock_at);
  assert.equal(snapshot.outcomes[0].reason, 'parent_club_fixture');
});

test('canonical submission and lock paths persist and regenerate snapshots', async () => {
  const decisions = await readFile(new URL('../netlify/functions/decisions.mjs', import.meta.url), 'utf8');
  const scheduler = await readFile(new URL('../src/world/sharedWorldScheduler.js', import.meta.url), 'utf8');
  assert.match(decisions, /loan_eligibility_snapshot: loanEligibilitySnapshot/);
  assert.match(scheduler, /createLoanEligibilitySnapshot/);
  assert.match(scheduler, /eligibility_checkpoint_at/);
  assert.match(scheduler, /selected_submissions: clone\(plan\.selected_submissions\)/);
});
