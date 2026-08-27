import { advancePersistentMatchday, validatePersistentMatchdayWorld } from './persistentMatchdayWorld.js';
import { loadPersistentWorld, savePersistentWorld } from './persistentSeasonLoop.js';
import { createLoanEligibilitySnapshot, findWorldFixture, ineligibleLoanPlayerIds } from './loanEligibility.js';
import { availabilityForPlayer } from '../matchEngine/squadAvailability.js';
import { competitiveRegistration } from './registrationEligibility.js';
import {
  alignCanonicalFixtureKickoffs,
  DEFAULT_TURN_HOUR_UTC,
  DEFAULT_TURN_WEEKDAYS_UTC,
  repairCompletedFixtureKickoffs
} from './canonicalTurnCalendar.js';

export const SHARED_WORLD_SCHEDULER_VERSION = 'tbg-shared-world-scheduler-v1.6';

const text = (value) => String(value ?? '').trim();
const clone = (value) => JSON.parse(JSON.stringify(value));
const unique = (values) => new Set(values).size === values.length;

function configuredTurnCalendar(world, override = null) {
  const persisted = world.matchday_cycle?.turn_calendar || {};
  const environment = typeof process !== 'undefined' ? process.env || {} : {};
  const environmentDays = String(environment.TBG_TURN_DAYS || '').split(',').map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);
  const environmentHour = Number(environment.TBG_TURN_HOUR_UTC);
  const weekdaysUtc = override?.weekdaysUtc || environmentDays.length && environmentDays || persisted.weekdays_utc || DEFAULT_TURN_WEEKDAYS_UTC;
  const hourUtc = override?.hourUtc ?? (Number.isFinite(environmentHour) ? environmentHour : persisted.hour_utc ?? DEFAULT_TURN_HOUR_UTC);
  return Object.freeze({ weekdays_utc: [...weekdaysUtc], hour_utc: Number(hourUtc) });
}

function normalizePortalTactics(tactics = {}) {
  const normalized = { ...(tactics || {}) };
  const width = text(normalized.width);
  if (width) {
    normalized.route_to_goal = width === 'narrow' ? 'central' : width;
    delete normalized.width;
  }
  delete normalized.defensive_line;
  return normalized;
}

function normalizeExecutionInstructions(instructionsByClub = {}) {
  return Object.fromEntries(Object.entries(instructionsByClub || {}).map(([clubId, instruction]) => {
    const normalized = clone(instruction || {});
    normalized.tactics = normalizePortalTactics(normalized.tactics);
    return [clubId, normalized];
  }));
}

export function currentTurnIdentity(world) {
  return Object.freeze({ world_id: world.world_id, season_id: world.squad_cycle.season_id, matchday: world.matchday_cycle?.current_matchday || 1 });
}

function selectedPlayerIds(instruction = {}) {
  return [...(instruction.starting_xi || []), ...(instruction.bench || [])].map(text).filter(Boolean);
}

function availabilityCalendarForClub(world, clubId) {
  const division = (world.competition?.divisions || []).find((row) => (row.club_ids || []).includes(text(clubId)));
  return division ? world.matchday_cycle?.runtimes?.[division.division_id]?.state?.availability || null : null;
}

export function validateManagerSelectionEligibility(world, clubId, instruction = {}) {
  const selected = selectedPlayerIds(instruction);
  if (!selected.length) return Object.freeze({ valid: true, errors: Object.freeze([]), invalid_player_ids: Object.freeze([]) });

  const selectedClubId = text(clubId);
  const club = world.squad_cycle?.clubs?.[selectedClubId];
  if (!club) return Object.freeze({ valid: false, errors: Object.freeze(['Submission club is not in the canonical world']), invalid_player_ids: Object.freeze(selected) });

  const owned = new Set((club.player_ids || []).map(text));
  const playerMap = world.squad_cycle?.players || {};
  const availabilityCalendar = availabilityCalendarForClub(world, selectedClubId);
  const matchday = Number(world.matchday_cycle?.current_matchday || 1);
  const invalid = [];
  const reasons = [];

  for (const playerId of selected) {
    const player = playerMap[playerId];
    if (!player || !owned.has(playerId)) {
      invalid.push(playerId);
      reasons.push(`${playerId} is not owned by the submitted club`);
      continue;
    }
    if (!competitiveRegistration(world, club, playerId, player).registered) {
      invalid.push(playerId);
      reasons.push(`${playerId} is not registered for competitive selection`);
      continue;
    }
    if (player.status && player.status !== 'active') {
      invalid.push(playerId);
      reasons.push(`${playerId} is not active`);
      continue;
    }
    if (availabilityCalendar?.players && Object.prototype.hasOwnProperty.call(availabilityCalendar.players, playerId)) {
      const availability = availabilityForPlayer(availabilityCalendar, playerId, matchday);
      if (!availability.available) {
        invalid.push(playerId);
        reasons.push(`${playerId} is ${availability.reason || 'unavailable'} for matchday ${matchday}`);
      }
    }
  }

  return Object.freeze({
    valid: invalid.length === 0,
    errors: Object.freeze(reasons),
    invalid_player_ids: Object.freeze([...new Set(invalid)])
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
  if (instruction.starting_xi && (!Array.isArray(instruction.starting_xi) || instruction.starting_xi.length !== 11 || !unique(instruction.starting_xi))) errors.push('Starting XI must contain exactly eleven unique players');
  if (instruction.bench && (!Array.isArray(instruction.bench) || !unique(instruction.bench))) errors.push('Substitutes must contain unique players');
  if (instruction.starting_xi && instruction.bench && !unique([...instruction.starting_xi, ...instruction.bench])) errors.push('A player cannot appear in both the starting XI and substitutes');
  if (worldClubIds.includes(text(submission.club_id))) {
    const eligibility = validateManagerSelectionEligibility(world, submission.club_id, instruction);
    errors.push(...eligibility.errors);
  }
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors), turn });
}

export function buildManagerTurnSubmission(world, { managerId, clubId, instruction = {}, submittedAt = new Date().toISOString(), nextTurnAt = null } = {}) {
  const turn = currentTurnIdentity(world);
  const submission = { version: SHARED_WORLD_SCHEDULER_VERSION, world_id: turn.world_id, season_id: turn.season_id, matchday: turn.matchday, manager_id: text(managerId), club_id: text(clubId), instruction: clone(instruction), status: 'submitted', submitted_at: submittedAt };
  const validation = validateManagerTurnSubmission(world, submission, { now: submittedAt, nextTurnAt });
  if (!validation.valid) throw new Error(validation.errors.join('; '));
  return Object.freeze(submission);
}

function activeAppointmentMap(world, appointments = []) {
  const worldClubIds = new Set(Object.keys(world.squad_cycle.clubs || {}));
  const byClub = new Map();
  for (const appointment of appointments) {
    if (appointment.status !== 'active' || text(appointment.world_id) !== text(world.world_id)) continue;
    const clubId = text(appointment.club_id), managerId = text(appointment.manager_id);
    if (clubId && managerId && worldClubIds.has(clubId)) byClub.set(clubId, managerId);
  }
  return byClub;
}

function fixtureForClubTurn(world, clubId, matchday) {
  const selectedClubId = text(clubId);
  const targetMatchday = Number(matchday);
  for (const runtime of Object.values(world.matchday_cycle?.runtimes || {})) {
    const fixture = (runtime?.fixtures || []).find((row) =>
      Number(row.matchday) === targetMatchday &&
      [text(row.home_club_id), text(row.away_club_id)].includes(selectedClubId)
    );
    if (fixture) return fixture;
  }
  return null;
}

function lockInstruction(world, submission, lockAt) {
  const instruction = clone(submission.instruction || {});
  instruction.tactics = normalizePortalTactics(instruction.tactics);
  const playerIds = selectedPlayerIds(instruction);
  if (!playerIds.length) return instruction;

  const selection = validateManagerSelectionEligibility(world, submission.club_id, instruction);
  if (!selection.valid) return null;

  const fixture = findWorldFixture(world, instruction.fixture_id)
    || fixtureForClubTurn(world, submission.club_id, submission.matchday);
  if (!fixture) return null;

  const eligibilityFixture = { ...fixture, eligibility_checkpoint_at: fixture.eligibility_checkpoint_at || fixture.lock_at || lockAt || fixture.kickoff_at };
  const snapshot = createLoanEligibilitySnapshot({ playerIds, clubId: submission.club_id, fixture: eligibilityFixture, world });
  const restricted = ineligibleLoanPlayerIds({ playerIds, clubId: submission.club_id, fixture: eligibilityFixture, world, snapshot });
  if (restricted.length) return null;
  instruction.loan_eligibility_snapshot = snapshot;
  return instruction;
}

export function selectTurnInstructions(world, submissions = [], appointments = [], { lockAt = null } = {}) {
  const turn = currentTurnIdentity(world);
  const appointedManagerByClub = activeAppointmentMap(world, appointments);
  const matching = submissions
    .filter((row) => row.world_id === turn.world_id && row.season_id === turn.season_id && Number(row.matchday) === turn.matchday)
    .filter((row) => row.status === 'submitted' || row.status === 'locked')
    .filter((row) => appointedManagerByClub.get(text(row.club_id)) === text(row.manager_id))
    .sort((a, b) => String(a.submitted_at).localeCompare(String(b.submitted_at)) || String(a.id || '').localeCompare(String(b.id || '')));
  const byClub = {}, selectedSubmissions = {}, rejectedSubmissions = {};
  for (const submission of matching) {
    const validation = validateManagerTurnSubmission(world, submission);
    if (!validation.valid) {
      rejectedSubmissions[submission.club_id] = {
        submission_id: submission.id || null,
        manager_id: submission.manager_id,
        submitted_at: submission.submitted_at,
        reason: validation.errors.join('; ')
      };
      continue;
    }
    const instruction = lockInstruction(world, submission, lockAt);
    if (!instruction) {
      rejectedSubmissions[submission.club_id] = {
        submission_id: submission.id || null,
        manager_id: submission.manager_id,
        submitted_at: submission.submitted_at,
        reason: 'Submission failed fixture-time eligibility validation'
      };
      continue;
    }
    byClub[submission.club_id] = instruction;
    selectedSubmissions[submission.club_id] = {
      submission_id: submission.id || null,
      manager_id: submission.manager_id,
      submitted_at: submission.submitted_at,
      ...(instruction.loan_eligibility_snapshot ? { loan_eligibility_snapshot: clone(instruction.loan_eligibility_snapshot) } : {})
    };
    delete rejectedSubmissions[submission.club_id];
  }
  return Object.freeze({
    turn,
    by_club: Object.freeze(byClub),
    selected_submissions: Object.freeze(selectedSubmissions),
    rejected_submissions: Object.freeze(rejectedSubmissions),
    appointed_club_ids: Object.freeze([...appointedManagerByClub.keys()].sort()),
    submission_count: Object.keys(byClub).length
  });
}

export function buildScheduledTurnPlan(worldInput, submissions = [], { appointments = [], scheduledFor = new Date().toISOString(), nextTurnAt = null, turnCalendar = null } = {}) {
  const world = loadPersistentWorld(savePersistentWorld(worldInput));
  const validation = validatePersistentMatchdayWorld(world);
  if (!validation.valid) throw new Error(`Canonical world is invalid: ${validation.errors.join('; ')}`);
  const selected = selectTurnInstructions(world, submissions, appointments, { lockAt: scheduledFor });
  const allClubIds = Object.keys(world.squad_cycle.clubs || {}).sort();
  const submittedClubIds = Object.keys(selected.by_club).sort();
  const fallbackClubIds = allClubIds.filter((id) => !submittedClubIds.includes(id));
  const instructionSourcesByClub = Object.fromEntries(allClubIds.map((clubId) => {
    const selectedSubmission = selected.selected_submissions[clubId];
    const rejectedSubmission = selected.rejected_submissions[clubId];
    return [clubId, selectedSubmission
      ? { type: 'manager_submission', ...clone(selectedSubmission) }
      : rejectedSubmission
        ? { type: 'deterministic_fallback', invalid_submission: clone(rejectedSubmission) }
        : { type: 'deterministic_fallback' }];
  }));
  return Object.freeze({
    version: SHARED_WORLD_SCHEDULER_VERSION,
    world_id: world.world_id,
    season_id: selected.turn.season_id,
    matchday: selected.turn.matchday,
    scheduled_for: scheduledFor,
    next_turn_at: nextTurnAt,
    turn_calendar: configuredTurnCalendar(world, turnCalendar),
    instructions_by_club: selected.by_club,
    instruction_sources_by_club: Object.freeze(instructionSourcesByClub),
    selected_submissions: selected.selected_submissions,
    rejected_submissions: selected.rejected_submissions,
    appointed_club_ids: selected.appointed_club_ids,
    submitted_club_ids: Object.freeze(submittedClubIds),
    fallback_club_ids: Object.freeze(fallbackClubIds),
    submission_count: submittedClubIds.length,
    fallback_count: fallbackClubIds.length
  });
}

export function executeScheduledTurn(worldInput, plan) {
  const world = loadPersistentWorld(savePersistentWorld(worldInput));
  const current = currentTurnIdentity(world);
  if (plan.world_id !== current.world_id || plan.season_id !== current.season_id || Number(plan.matchday) !== current.matchday) throw new Error('Scheduled turn plan is stale');
  const cadence = plan.turn_calendar || configuredTurnCalendar(world);
  const executionInstructions = normalizeExecutionInstructions(plan.instructions_by_club);
  repairCompletedFixtureKickoffs(world);
  if (world.matchday_cycle) alignCanonicalFixtureKickoffs(world, { currentMatchday: current.matchday, currentTurnAt: plan.scheduled_for, nextTurnAt: plan.next_turn_at, weekdaysUtc: cadence.weekdays_utc, hourUtc: cadence.hour_utc });
  const advance = advancePersistentMatchday(world, { instructionsByClub: executionInstructions, instructionSourcesByClub: plan.instruction_sources_by_club });
  if (!advance.accepted) throw new Error('Scheduled matchday advance was rejected');
  if (advance.world.matchday_cycle && plan.next_turn_at) alignCanonicalFixtureKickoffs(advance.world, { currentMatchday: advance.world.matchday_cycle.current_matchday, currentTurnAt: plan.next_turn_at, weekdaysUtc: cadence.weekdays_utc, hourUtc: cadence.hour_utc });
  advance.world.shared_turn_history ||= [];
  advance.world.shared_turn_history.push({
    version: SHARED_WORLD_SCHEDULER_VERSION,
    world_id: plan.world_id,
    season_id: plan.season_id,
    matchday: plan.matchday,
    scheduled_for: plan.scheduled_for,
    next_turn_at: plan.next_turn_at,
    turn_calendar: clone(cadence),
    appointed_club_ids: [...plan.appointed_club_ids],
    submitted_club_ids: [...plan.submitted_club_ids],
    fallback_club_ids: [...plan.fallback_club_ids],
    instruction_sources_by_club: clone(plan.instruction_sources_by_club),
    selected_submissions: clone(plan.selected_submissions),
    rejected_submissions: clone(plan.rejected_submissions || {}),
    submission_count: plan.submission_count,
    fallback_count: plan.fallback_count,
    checkpoint_id: advance.checkpoint.checkpoint_id
  });
  const savedWorld = savePersistentWorld(advance.world);
  const restored = loadPersistentWorld(savedWorld);
  return Object.freeze({ version: SHARED_WORLD_SCHEDULER_VERSION, accepted: true, plan, advance, world: restored, saved_world: savedWorld, previous_turn: current, next_turn: currentTurnIdentity(restored) });
}
