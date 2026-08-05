import test from 'node:test';
import assert from 'node:assert/strict';
import { syntheticPlayableLeagueStructure } from '../src/matchEngine/leagueStructureSimulation.js';
import { createPersistentLeagueWorld } from '../src/world/persistentLeagueWorld.js';
import {
  buildManagerTurnSubmission,
  buildScheduledTurnPlan,
  currentTurnIdentity,
  executeScheduledTurn,
  validateManagerTurnSubmission
} from '../src/world/sharedWorldScheduler.js';

function world() {
  const divisions = syntheticPlayableLeagueStructure({ clubsPerDivision: 4 });
  return createPersistentLeagueWorld({
    worldId: 'pr196-invalid-xi',
    divisions,
    humanClubId: divisions[0].clubs[0].club_id,
    movementCount: 1
  });
}

function invalidSelection(source) {
  const clubId = source.human_club_id;
  const club = source.squad_cycle.clubs[clubId];
  const startingXi = club.registered_player_ids.slice(0, 11);
  const invalidPlayerId = startingXi[5];
  club.registered_player_ids = club.registered_player_ids.filter((id) => id !== invalidPlayerId);
  return { clubId, startingXi, invalidPlayerId };
}

test('team submission rejects an owned but unregistered player before persistence', () => {
  const source = world();
  const { clubId, startingXi, invalidPlayerId } = invalidSelection(source);

  assert.throws(() => buildManagerTurnSubmission(source, {
    managerId: 'manager-one',
    clubId,
    instruction: { formation: '4-3-3-wide', starting_xi: startingXi },
    submittedAt: '2026-08-04T12:00:00.000Z',
    nextTurnAt: '2026-08-04T20:00:00.000Z'
  }), new RegExp(`${invalidPlayerId} is not registered for competitive selection`));
});

test('a locked invalid human XI falls back for that club without failing the shared turn', () => {
  const source = world();
  const { clubId, startingXi, invalidPlayerId } = invalidSelection(source);
  const turn = currentTurnIdentity(source);
  const submission = {
    ...turn,
    id: 'real-madrid-style-invalid-submission',
    manager_id: 'manager-one',
    club_id: clubId,
    status: 'locked',
    submitted_at: '2026-08-04T12:00:00.000Z',
    instruction: { formation: '4-3-3-wide', starting_xi: startingXi }
  };
  const appointment = { world_id: source.world_id, manager_id: 'manager-one', club_id: clubId, status: 'active' };

  const validation = validateManagerTurnSubmission(source, submission);
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join('; '), new RegExp(invalidPlayerId));

  const plan = buildScheduledTurnPlan(source, [submission], {
    appointments: [appointment],
    scheduledFor: '2026-08-04T20:00:00.000Z',
    nextTurnAt: '2026-08-07T20:00:00.000Z'
  });

  assert.equal(plan.submission_count, 0);
  assert.ok(plan.fallback_club_ids.includes(clubId));
  assert.equal(plan.instruction_sources_by_club[clubId].type, 'deterministic_fallback');
  assert.equal(plan.instruction_sources_by_club[clubId].invalid_submission.submission_id, submission.id);
  assert.match(plan.instruction_sources_by_club[clubId].invalid_submission.reason, new RegExp(invalidPlayerId));

  const result = executeScheduledTurn(source, plan);
  assert.equal(result.accepted, true);
  assert.equal(result.world.matchday_cycle.current_matchday, 2);
  assert.match(result.world.shared_turn_history[0].rejected_submissions[clubId].reason, new RegExp(invalidPlayerId));
});
