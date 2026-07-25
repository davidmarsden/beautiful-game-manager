import crypto from 'node:crypto';

const TERMINAL = new Set(['applied', 'rejected', 'superseded']);
const TRANSFER_TYPES = new Set(['transfer_offer', 'transfer_listing', 'transfer_response']);

export function commandSubjectKey(command) {
  const payload = command.command_payload || command.payload || {};
  const playerId = payload.playerId || payload.player_id || '';
  const otherClubId = payload.otherClubId || payload.other_club_id || '';
  if (command.command_type === 'register_player' || command.command_type === 'unregister_player') return `registration:${playerId}`;
  if (command.command_type === 'renew_contract') return `contract:${playerId}`;
  if (TRANSFER_TYPES.has(command.command_type)) return `transfer:${playerId}:${otherClubId}`;
  return String(command.command_type || 'manager_request');
}

export function commandRequestKey(command) {
  const payload = command.command_payload || command.payload || {};
  const supplied = payload.client_request_id || command.request_key;
  if (supplied) return String(supplied);
  return crypto.createHash('sha256').update(JSON.stringify({
    world_id: command.world_id,
    manager_id: command.manager_id,
    club_id: command.club_id,
    command_type: command.command_type,
    command_payload: payload,
    effective_season_id: command.effective_season_id,
    effective_matchday: command.effective_matchday
  })).digest('hex');
}

export function initialNegotiationState(commandType, payload = {}) {
  if (commandType === 'transfer_offer') return 'awaiting_selling_club_response';
  if (commandType === 'transfer_listing') return 'listed_awaiting_offer';
  if (commandType === 'transfer_response') {
    const response = String(payload.response || '').toLowerCase();
    if (response === 'accept' || response === 'accepted') return 'accepted_awaiting_application';
    if (response === 'reject' || response === 'rejected' || response === 'decline' || response === 'declined') return 'declined';
    if (response === 'counter') return 'counter_offer_submitted';
    return 'response_submitted';
  }
  return null;
}

export function isTerminalStatus(status) {
  return TERMINAL.has(status);
}

export function shouldSupersede(older, newer) {
  return older.id !== newer.id
    && older.world_id === newer.world_id
    && older.manager_id === newer.manager_id
    && older.status === 'pending'
    && commandSubjectKey(older) === commandSubjectKey(newer);
}

export function transferProcessingDecision(command) {
  if (!TRANSFER_TYPES.has(command.command_type)) return { action: 'apply_domain_command' };
  const state = command.negotiation_state || initialNegotiationState(command.command_type, command.command_payload);
  if (state === 'declined') return { action: 'finalize', status: 'rejected', negotiation_state: 'declined', reason: 'The transfer proposal was declined.' };
  if (state === 'accepted_awaiting_application') return { action: 'apply_transfer', negotiation_state: state };
  return { action: 'defer', negotiation_state: state, reason: 'Transfer negotiation remains open and will not be rejected at this checkpoint.' };
}

export function finalOutcomeKey(commandId, status) {
  if (!TERMINAL.has(status)) throw new Error(`Cannot create a final outcome key for non-terminal status: ${status}`);
  return `command:${commandId}:${status}`;
}

export function managerFacingHistory(command) {
  const submitted = command.submitted_at ? new Date(command.submitted_at).toISOString() : null;
  const finished = command.terminal_at || command.processed_at;
  const status = String(command.status || 'pending');
  return {
    status,
    status_label: status === 'applied' ? 'Applied' : status === 'rejected' ? 'Rejected' : status === 'superseded' ? 'Superseded' : 'Pending',
    submitted_at: submitted,
    finished_at: finished ? new Date(finished).toISOString() : null,
    reason: command.outcome_reason || (status === 'pending' ? 'Awaiting the next applicable shared-world checkpoint.' : null),
    negotiation_state: command.negotiation_state || null
  };
}
