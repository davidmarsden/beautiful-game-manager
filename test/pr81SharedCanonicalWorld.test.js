import test from 'node:test';
import assert from 'node:assert/strict';
import { syntheticPlayableLeagueStructure } from '../src/matchEngine/leagueStructureSimulation.js';
import { createPersistentLeagueWorld } from '../src/world/persistentLeagueWorld.js';
import {
  buildManagerTurnSubmission,
  buildScheduledTurnPlan,
  currentTurnIdentity,
  executeScheduledTurn,
  selectTurnInstructions,
  validateManagerTurnSubmission
} from '../src/world/sharedWorldScheduler.js';
import { nextScheduledTurn } from '../netlify/functions/scheduled-world-turn.mjs';

function world() {
  const divisions = syntheticPlayableLeagueStructure({ clubsPerDivision: 4 });
  return createPersistentLeagueWorld({
    worldId: 'pr81-shared-world',
    divisions,
    humanClubId: divisions[0].clubs[0].club_id,
    movementCount: 1
  });
}

test('a manager submits instructions to the shared current turn rather than owning a save', () => {
  const source = world();
  const submission = buildManagerTurnSubmission(source, {
    managerId: 'manager-one',
    clubId: source.human_club_id,
    instruction: { formation: '4-2-3-1', tactics: { mentality: 'positive' } },
    submittedAt: '2026-07-22T12:00:00.000Z',
    nextTurnAt: '2026-07-23T20:00:00.000Z'
  });
  assert.deepEqual(currentTurnIdentity(source), {
    world_id: source.world_id,
    season_id: source.squad_cycle.season_id,
    matchday: 1
  });
  assert.equal(submission.status, 'submitted');
  assert.equal(submission.club_id, source.human_club_id);
  assert.equal(validateManagerTurnSubmission(source, submission, { now: submission.submitted_at, nextTurnAt: '2026-07-23T20:00:00.000Z' }).valid, true);
});

test('submissions are rejected after the central deadline', () => {
  const source = world();
  assert.throws(() => buildManagerTurnSubmission(source, {
    managerId: 'manager-one', clubId: source.human_club_id,
    submittedAt: '2026-07-23T20:00:00.000Z', nextTurnAt: '2026-07-23T20:00:00.000Z'
  }), /deadline has passed/);
});

test('latest club submission wins and missing clubs use deterministic fallback', () => {
  const source = world();
  const turn = currentTurnIdentity(source);
  const rows = [
    { ...turn, manager_id: 'm1', club_id: source.human_club_id, instruction: { formation: '4-4-2' }, status: 'submitted', submitted_at: '2026-07-22T10:00:00.000Z' },
    { ...turn, manager_id: 'm1', club_id: source.human_club_id, instruction: { formation: '4-2-3-1' }, status: 'submitted', submitted_at: '2026-07-22T11:00:00.000Z' }
  ];
  const selected = selectTurnInstructions(source, rows);
  assert.equal(selected.submission_count, 1);
  assert.equal(selected.by_club[source.human_club_id].formation, '4-2-3-1');
  const plan = buildScheduledTurnPlan(source, rows, { scheduledFor: '2026-07-23T20:00:00.000Z' });
  assert.equal(plan.submission_count, 1);
  assert.equal(plan.fallback_count, 19);
});

test('only the central scheduler advances the canonical world and records the turn ledger', () => {
  const source = world();
  const submission = buildManagerTurnSubmission(source, {
    managerId: 'manager-one', clubId: source.human_club_id,
    instruction: { formation: '4-2-3-1' },
    submittedAt: '2026-07-22T12:00:00.000Z', nextTurnAt: '2026-07-23T20:00:00.000Z'
  });
  const plan = buildScheduledTurnPlan(source, [submission], { scheduledFor: '2026-07-23T20:00:00.000Z' });
  const result = executeScheduledTurn(source, plan);
  assert.equal(result.accepted, true);
  assert.equal(result.advance.matchday, 1);
  assert.equal(result.world.matchday_cycle.current_matchday, 2);
  assert.equal(result.world.shared_turn_history.length, 1);
  assert.equal(result.world.shared_turn_history[0].checkpoint_id, result.advance.checkpoint.checkpoint_id);
});

test('the twice-weekly scheduler resolves the next configured turn', () => {
  const next = nextScheduledTurn(new Date('2026-07-22T21:00:00.000Z'));
  assert.ok(new Date(next) > new Date('2026-07-22T21:00:00.000Z'));
  assert.ok([2, 5].includes(new Date(next).getUTCDay()));
});
