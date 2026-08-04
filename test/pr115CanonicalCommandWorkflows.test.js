import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { commandForDomain } from '../netlify/functions/scheduled-world-turn.mjs';
import {
  commandRequestKey,
  commandSubjectKey,
  finalOutcomeKey,
  initialNegotiationState,
  managerFacingHistory,
  shouldSupersede,
  transferProcessingDecision
} from '../src/world/managerCommandWorkflow.js';

const base = {
  id: 'old', world_id: 'world-1', manager_id: 'manager-1', club_id: 'club-1',
  command_type: 'renew_contract', command_payload: { playerId: 'player-1', years: 2 },
  effective_season_id: 'season-1', effective_matchday: 4, status: 'pending'
};

test('same command has a deterministic idempotency key', () => {
  assert.equal(commandRequestKey(base), commandRequestKey(structuredClone(base)));
  assert.notEqual(commandRequestKey(base), commandRequestKey({ ...base, command_payload: { playerId: 'player-1', years: 3 } }));
});

test('newer request supersedes only the same manager workflow subject', () => {
  const newer = { ...base, id: 'new', command_payload: { playerId: 'player-1', years: 3 } };
  assert.equal(commandSubjectKey(base), 'contract:player-1');
  assert.equal(shouldSupersede(base, newer), true);
  assert.equal(shouldSupersede(base, { ...newer, manager_id: 'manager-2' }), false);
  assert.equal(shouldSupersede({ ...base, status: 'applied' }, newer), false);
});

test('transfer commands expose explicit negotiation states instead of generic rejection', () => {
  assert.equal(initialNegotiationState('transfer_offer'), 'awaiting_selling_club_response');
  assert.equal(initialNegotiationState('transfer_listing'), 'listed_awaiting_offer');
  assert.equal(initialNegotiationState('transfer_response', { response: 'counter' }), 'counter_offer_submitted');
  assert.deepEqual(transferProcessingDecision({ command_type: 'transfer_offer', command_payload: {} }), {
    action: 'defer',
    negotiation_state: 'awaiting_selling_club_response',
    reason: 'Transfer negotiation remains open and will not be rejected at this checkpoint.'
  });
  assert.equal(transferProcessingDecision({ command_type: 'transfer_response', command_payload: { response: 'accepted' } }).action, 'apply_transfer');
});

test('accepted transfer responses use the canonical transfer command', () => {
  assert.deepEqual(commandForDomain({
    command_type: 'transfer_response',
    command_payload: {
      response: 'accepted', playerId: 'player-1', direction: 'buy', otherClubId: 'club-2',
      fee: 1200000, contractYears: 4, wage: 30000
    }
  }), {
    type: 'transfer_player', playerId: 'player-1', direction: 'buy', otherClubId: 'club-2',
    fee: 1200000, contractYears: 4, wage: 30000
  });
  assert.equal(commandForDomain({
    command_type: 'transfer_response',
    command_payload: { response: 'declined', playerId: 'player-1' }
  }), null);
});

test('final outcome and manager history are stable and explicit', () => {
  assert.equal(finalOutcomeKey('command-1', 'applied'), 'command:command-1:applied');
  assert.deepEqual(managerFacingHistory({
    status: 'superseded', submitted_at: '2026-07-25T18:00:00.000Z', processed_at: '2026-07-25T18:05:00.000Z',
    outcome_reason: 'Replaced by a newer request.'
  }), {
    status: 'superseded', status_label: 'Superseded', submitted_at: '2026-07-25T18:00:00.000Z',
    finished_at: '2026-07-25T18:05:00.000Z', reason: 'Replaced by a newer request.', negotiation_state: null
  });
});

test('migration enforces one audit and one message per final outcome', () => {
  const sql = fs.readFileSync(new URL('../supabase/migrations/20260725_pr115_canonical_command_workflows.sql', import.meta.url), 'utf8');
  const metadataSql = fs.readFileSync(new URL('../supabase/migrations/20260725_pr114a_manager_message_metadata.sql', import.meta.url), 'utf8');
  assert.match(metadataSql, /add column if not exists metadata jsonb/i);
  assert.match(sql, /unique\(command_id\)/i);
  assert.match(sql, /manager_messages_command_outcome_uidx/i);
  assert.match(sql, /on conflict \(command_id\) do nothing/i);
  assert.match(sql, /finalize_manager_world_command/i);
  assert.match(sql, /status in \('applied','rejected','superseded'\)/i);
});

test('command RPC permissions enforce appointment and trusted finalisation', () => {
  const sql = fs.readFileSync(new URL('../supabase/migrations/20260725_pr115c_command_rpc_security.sql', import.meta.url), 'utf8');
  assert.match(sql, /manager_appointments appointment[\s\S]*appointment\.manager_id = p_manager_id[\s\S]*appointment\.world_id = p_world_id[\s\S]*appointment\.club_id = p_club_id[\s\S]*appointment\.status = 'active'/i);
  assert.match(sql, /grant execute on function public\.submit_manager_world_command[\s\S]*to authenticated/i);
  assert.match(sql, /revoke all on function public\.finalize_manager_world_command[\s\S]*from authenticated/i);
  assert.match(sql, /grant execute on function public\.finalize_manager_world_command[\s\S]*to service_role/i);
  assert.match(sql, /drop function if exists public\.finalize_manager_world_command\(uuid, text, text, jsonb, text, text, text, timestamptz\)/i);
});

test('scheduler keeps unresolved negotiations eligible beyond their original matchday', () => {
  const scheduler = fs.readFileSync(new URL('../netlify/internal/scheduled-world-turn-worker.mjs', import.meta.url), 'utf8');
  assert.match(scheduler, /effective_matchday=lte\.\$\{matchday\}/);
  assert.match(scheduler, /responseValue\(payload\) === 'accepted'/);
  assert.match(scheduler, /\['declined', 'rejected'\]\.includes\(transferResponse\)/);
});
