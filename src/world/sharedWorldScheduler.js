import { advancePersistentMatchday, validatePersistentMatchdayWorld } from './persistentMatchdayWorld.js';
import { loadPersistentWorld, savePersistentWorld } from './persistentSeasonLoop.js';

export const SHARED_WORLD_SCHEDULER_VERSION = 'tbg-shared-world-scheduler-v1.0';

const text = (value) => String(value ?? '').trim();
const clone = (value) => JSON.parse(JSON.stringify(value));
const unique = (values) => new Set(values).size === values.length;

export function currentTurnIdentity(world) {
  return Object.freeze({
    world_id: world.world_id,
    season_id: world.squad_cycle.season_id,
    matchday: world.matchday_cycle?.current_matchday || 1
  });
}

export function validateManagerTurnSubmission(world, submission, { now = new Date().toISOString(), nextTurnAt = null } = {}) {
  const errors = [];
  const turn = currentTurnIdentity(world);
  if (text(submission.world_id) !== turn.world_id) errors.push('Submission world does not match canonical world');
  if (text(submission.season_id) !== turn.season_id) errors.push('Submission season does not match current season');
  if (Number(submission.matchday) !== turn.matchday) errors.push('Submission matchday does not match current matchday');
  if (!text(submission.manager_id)) errors.push('Submission manager is required');
  if (!text(submission.club_id)) errors.push('Submission club is required');
  const worldClubIds = Object.keys(world.squad_cycle.clubs || {});
  if (!worldClubIds.includes(text(submission.club_id))) errors.push('Submission club is not in the canonical world');
  if (nextTurnAt && new Date(now) >= new Date(nextTurnAt)) errors.push('The turn deadline has passed');
  const instruction = submission.instruction || {};
  if (instruction.starting_xi && (!Array.isArray(instruction.starting_xi) || instruction.starting_xi.length !== 11 || !unique(instruction.starting_xi))) {
    errors.push('Starting XI must contain exactly eleven unique players');
  }
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors), turn });
}

export function buildManagerTurnSubmission(world, {
  managerId,
  clubId,
  instruction = {},
  submittedAt = new Date().toISOString(),
  nextTurnAt = null
} = {}) {
  const turn = currentTurnIdentity(world);
  const submission = {
    version: SHARED_WORLD_SCHEDULER_VERSION,
    world_id: turn.world_id,
    season_id: turn.season_id,
    matchday: turn.matchday,
    manager_id: text(managerId),
    club_id: text(clubId),
    instruction: clone(instruction),
    status: 'submitted',
    submitted_at: submittedAt
  };
  const validation = validateManagerTurnSubmission(world, submission, { now: submittedAt, nextTurnAt });
  if (!validation.valid) throw new Error(validation.errors.join('; '));
  return Object.freeze(submission);
}

export function selectTurnInstructions(world, submissions = []) {
  const turn = currentTurnIdentity(world);
  const matching = submissions
    .filter((row) => row.world_id === turn.world_id && row.season_id === turn.season_id && Number(row.matchday) === turn.matchday)
    .filter((row) => row.status === 'submitted' || row.status === 'locked')
    .sort((a, b) => String(a.submitted_at).localeCompare(String(b.submitted_at)));
  const byClub = {};
  for (const submission of matching) byClub[submission.club_id] = clone(submission.instruction || {});
  return Object.freeze({ turn, by_club: Object.freeze(byClub), submission_count: Object.keys(byClub).length });
}

export function buildScheduledTurnPlan(worldInput, submissions = [], {
  scheduledFor = new Date().toISOString(),
  nextTurnAt = null
} = {}) {
  const world = loadPersistentWorld(savePersistentWorld(worldInput));
  const validation = validatePersistentMatchdayWorld(world);
  if (!validation.valid) throw new Error(`Canonical world is invalid: ${validation.errors.join('; ')}`);
  const selected = selectTurnInstructions(world, submissions);
  const allClubIds = Object.keys(world.squad_cycle.clubs || {}).sort();
  const submittedClubIds = Object.keys(selected.by_club).sort();
  const missingClubIds = allClubIds.filter((id) => !submittedClubIds.includes(id));
  return Object.freeze({
    version: SHARED_WORLD_SCHEDULER_VERSION,
    world_id: world.world_id,
    season_id: selected.turn.season_id,
    matchday: selected.turn.matchday,
    scheduled_for: scheduledFor,
    next_turn_at: nextTurnAt,
    instructions_by_club: selected.by_club,
    submitted_club_ids: Object.freeze(submittedClubIds),
    fallback_club_ids: Object.freeze(missingClubIds),
    submission_count: submittedClubIds.length,
    fallback_count: missingClubIds.length
  });
}

export function executeScheduledTurn(worldInput, plan) {
  const world = loadPersistentWorld(savePersistentWorld(worldInput));
  const current = currentTurnIdentity(world);
  if (plan.world_id !== current.world_id || plan.season_id !== current.season_id || Number(plan.matchday) !== current.matchday) {
    throw new Error('Scheduled turn plan is stale');
  }

  // The current matchday engine has one designated human-control slot. The shared scheduler
  // chooses that club's submitted instruction while retaining every club submission in the
  // immutable turn ledger. Missing or unsupported submissions fall back to deterministic AI.
  const designatedInstruction = plan.instructions_by_club[world.human_club_id] || {};
  const advance = advancePersistentMatchday(world, { humanInstruction: designatedInstruction });
  if (!advance.accepted) throw new Error('Scheduled matchday advance was rejected');

  advance.world.shared_turn_history ||= [];
  advance.world.shared_turn_history.push({
    version: SHARED_WORLD_SCHEDULER_VERSION,
    world_id: plan.world_id,
    season_id: plan.season_id,
    matchday: plan.matchday,
    scheduled_for: plan.scheduled_for,
    submitted_club_ids: [...plan.submitted_club_ids],
    fallback_club_ids: [...plan.fallback_club_ids],
    submission_count: plan.submission_count,
    fallback_count: plan.fallback_count,
    checkpoint_id: advance.checkpoint.checkpoint_id
  });
  const savedWorld = savePersistentWorld(advance.world);
  const restored = loadPersistentWorld(savedWorld);
  return Object.freeze({
    version: SHARED_WORLD_SCHEDULER_VERSION,
    accepted: true,
    plan,
    advance,
    world: restored,
    saved_world: savedWorld,
    previous_turn: current,
    next_turn: currentTurnIdentity(restored)
  });
}
