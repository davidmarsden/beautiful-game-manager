import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syntheticPlayableLeagueStructure } from '../src/matchEngine/leagueStructureSimulation.js';
import { createPersistentLeagueWorld } from '../src/world/persistentLeagueWorld.js';
import { advancePersistentMatchday } from '../src/world/persistentMatchdayWorld.js';
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

function activeAppointment(source, clubId) {
  return { world_id: source.world_id, manager_id: 'manager-one', club_id: clubId, status: 'active' };
}

function lockedSubmission(source, clubId, startingXi, id = 'invalid-submission') {
  return {
    ...currentTurnIdentity(source),
    id,
    manager_id: 'manager-one',
    club_id: clubId,
    status: 'locked',
    submitted_at: '2026-08-04T12:00:00.000Z',
    instruction: { formation: '4-3-3-wide', starting_xi: startingXi }
  };
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
  const submission = lockedSubmission(source, clubId, startingXi, 'real-madrid-style-invalid-submission');

  const validation = validateManagerTurnSubmission(source, submission);
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join('; '), new RegExp(invalidPlayerId));

  const plan = buildScheduledTurnPlan(source, [submission], {
    appointments: [activeAppointment(source, clubId)],
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

test('an injured or suspended selected player is rejected before engine execution', () => {
  const source = advancePersistentMatchday(world()).world;
  const clubId = source.human_club_id;
  const club = source.squad_cycle.clubs[clubId];
  const startingXi = club.registered_player_ids.slice(0, 11);
  const unavailablePlayerId = startingXi[4];
  const division = source.competition.divisions.find((row) => row.club_ids.includes(clubId));
  const calendar = source.matchday_cycle.runtimes[division.division_id].state.availability;
  calendar.players[unavailablePlayerId].injury_until_matchday = source.matchday_cycle.current_matchday;

  const submission = lockedSubmission(source, clubId, startingXi, 'injured-player-submission');
  const validation = validateManagerTurnSubmission(source, submission);
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join('; '), new RegExp(`${unavailablePlayerId} is injured`));

  const plan = buildScheduledTurnPlan(source, [submission], {
    appointments: [activeAppointment(source, clubId)],
    scheduledFor: '2026-08-04T20:00:00.000Z'
  });
  assert.equal(plan.submission_count, 0);
  assert.equal(plan.instruction_sources_by_club[clubId].type, 'deterministic_fallback');
  assert.match(plan.rejected_submissions[clubId].reason, /injured/);
  assert.equal(executeScheduledTurn(source, plan).accepted, true);
});

test('the interactive formation board filters disabled and ineligible player labels', () => {
  const board = fs.readFileSync(new URL('../public/formation-board.js', import.meta.url), 'utf8');
  const guard = fs.readFileSync(new URL('../public/team-selection-eligibility-guard.js', import.meta.url), 'utf8');
  const profile = fs.readFileSync(new URL('../public/player-profile.js', import.meta.url), 'utf8');
  assert.match(board, /!input\?\.disabled/);
  assert.match(board, /selectionIneligible/);
  assert.match(board, /tbg:selection-eligibility-updated/);
  assert.match(board, /allowedPlayerIds\.has/);
  assert.match(guard, /label\.dataset\.selectionIneligible = 'true'/);
  assert.match(guard, /Unregistered/);
  assert.match(profile, /registered === false/);
  assert.match(profile, /Selection status/);
});
