import { loadPersistentWorld, savePersistentWorld } from '../../../src/world/persistentSeasonLoop.js';
import { activeTransferWindow, unregisterPlayer } from '../../../src/squadCycle/squadCycle.js';
import { ensureClubFinanceState } from '../../../src/squadCycle/clubFinance.js';
import { buildWorldReadModel } from '../../../src/world/worldReadModel.js';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const isJwt = (value) => String(value || '').split('.').length === 3;

async function service(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      ...(isJwt(SUPABASE_SERVICE_ROLE_KEY) ? { authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } : {}),
      accept: 'application/json',
      'content-type': 'application/json',
      prefer: options.prefer || 'return=representation',
      ...(options.headers || {})
    }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || body.error || `Supabase returned ${response.status}`);
  return body;
}

function updateOwnershipProjection(world, playerId, toClubId) {
  const updateRows = (rows) => {
    if (!Array.isArray(rows)) return;
    for (const row of rows) {
      const id = String(row?.tbg_player_id || row?.player_id || row?.id || '');
      if (id === String(playerId)) row.club_id = toClubId;
    }
  };
  updateRows(world.player_ownership);
  updateRows(world.squad_cycle?.player_ownership);
  for (const runtime of Object.values(world.matchday_cycle?.runtimes || {})) {
    if (runtime?.state?.players?.[playerId]) {
      runtime.state.players[playerId].club_id = toClubId;
      runtime.state.players[playerId].assignment_status = 'external';
    }
  }
}

function event(state, type, at, payload = {}) {
  state.events ||= [];
  const row = Object.freeze({
    event_id: `${state.season_id}:${String(state.events.length + 1).padStart(4, '0')}:${type}`,
    type,
    at: new Date(at).toISOString(),
    ...payload
  });
  state.events.push(row);
  return row;
}

function externalLegs(due) {
  if (due?.deal_origin !== 'external_market') throw new Error('External settlement requires an external-market deal');
  const legs = Array.isArray(due?.legs) ? due.legs : [];
  const playerLegs = legs.filter((leg) => leg?.leg_type === 'permanent_transfer');
  const cashLegs = legs.filter((leg) => leg?.leg_type === 'cash');
  if (playerLegs.length !== 1) throw new Error('External settlement requires exactly one player leg');
  if (cashLegs.length !== 1) throw new Error('External settlement requires exactly one cash leg');
  const player = playerLegs[0];
  const cash = cashLegs[0];
  const externalName = String(due.external_club_name || player.to_club_id || '').trim();
  const externalSourceId = String(due.external_club_source_id || '').trim();
  if (!externalName || !externalSourceId) throw new Error('External settlement requires a mirrored TPF club identity');
  if (player.to_club_id !== externalName) throw new Error('External player leg does not match the mirrored destination club');
  if (cash.from_club_id !== externalName || cash.to_club_id !== player.from_club_id) {
    throw new Error('External settlement cash consideration does not match the transfer');
  }
  const fee = Math.max(0, Number(cash.amount) || 0);
  if (!(fee > 0)) throw new Error('External settlement requires positive transfer consideration');
  return { playerLeg: player, cashLeg: cash, externalName, externalSourceId, fee };
}

export function applyExternalTransferToWorld(world, due) {
  const state = world?.squad_cycle;
  if (!state) throw new Error('External settlement requires a squad-cycle world');
  const at = new Date(world.clock).toISOString();
  if (!activeTransferWindow(state, at)) throw new Error(`Transfer window is closed at ${at}`);

  const { playerLeg, externalName, externalSourceId, fee } = externalLegs(due);
  const seller = state.clubs?.[playerLeg.from_club_id];
  if (!seller) throw new Error(`Unknown selling club: ${playerLeg.from_club_id}`);
  const player = state.players?.[playerLeg.player_id];
  if (!player) throw new Error(`Unknown player: ${playerLeg.player_id}`);
  if (player.club_id !== seller.club_id || !seller.player_ids.includes(player.tbg_player_id)) {
    throw new Error(`${player.tbg_player_id} is not owned by ${seller.club_id}`);
  }

  const registration = state.registrations?.[player.tbg_player_id];
  if (registration?.registered) {
    unregisterPlayer(state, {
      clubId: seller.club_id,
      playerId: player.tbg_player_id,
      at,
      reason: 'external_transfer'
    });
  } else if (registration) {
    registration.registered = false;
    registration.unregistered_at ||= at;
    registration.reason = 'external_transfer';
  }

  const contract = player.contract_id ? state.contracts?.[player.contract_id] : null;
  if (contract?.status === 'active') {
    contract.status = 'transferred_external';
    contract.ended_at = at;
    contract.end_reason = 'EXTERNAL_TRANSFER';
  }

  seller.player_ids = seller.player_ids.filter((id) => id !== player.tbg_player_id);
  seller.registered_player_ids = seller.registered_player_ids.filter((id) => id !== player.tbg_player_id);

  player.club_id = null;
  player.assignment_status = 'external';
  player.external_club_source_id = externalSourceId;
  player.external_club_name = externalName;
  player.external_transfer_at = at;
  player.external_transfer_fee = fee;
  player.external_transfer_deal_id = due.deal_id;

  ensureClubFinanceState(state);
  const sellerFinance = state.finances?.clubs?.[seller.club_id];
  if (!sellerFinance) throw new Error(`Missing finance state for ${seller.club_id}`);
  sellerFinance.cash_balance = Math.round((Number(sellerFinance.cash_balance || 0) + fee) * 100) / 100;

  event(state, 'cash_received_external_transfer', at, {
    club_id: seller.club_id,
    player_id: player.tbg_player_id,
    external_club_source_id: externalSourceId,
    external_club_name: externalName,
    amount: fee,
    currency: sellerFinance.currency || 'GBP'
  });
  event(state, 'player_transferred_external', at, {
    club_id: seller.club_id,
    player_id: player.tbg_player_id,
    external_club_source_id: externalSourceId,
    external_club_name: externalName,
    fee,
    deal_id: due.deal_id
  });

  updateOwnershipProjection(world, player.tbg_player_id, null);
  return { player_id: player.tbg_player_id, seller_club_id: seller.club_id, external_club_source_id: externalSourceId, external_club_name: externalName, fee };
}

async function reconcileSettlement(dealId, replacementChecksum) {
  const rows = await service(`/rest/v1/transfer_deals?id=eq.${encodeURIComponent(dealId)}&select=id,status,settlement_replacement_checksum&limit=1`);
  const row = rows[0];
  return Boolean(row?.status === 'completed' && row?.settlement_replacement_checksum === replacementChecksum);
}

async function failDeal(dealId, error) {
  return service('/rest/v1/rpc/fail_transfer_deal_application', {
    method: 'POST',
    body: JSON.stringify({ p_deal_id: dealId, p_reason: String(error?.message || error) })
  });
}

function deterministicSettlementError(error) {
  return /Transfer window is closed|Unknown selling club|Unknown player|is not owned by|mirrored TPF club identity|does not match|cash consideration|positive transfer consideration|squad-cycle world|Missing finance state|exactly one player leg|exactly one cash leg/i.test(String(error?.message || error));
}

async function settleOne(due) {
  const worldRows = await service(`/rest/v1/canonical_world_saves?world_id=eq.${encodeURIComponent(due.world_id)}&select=*`);
  const before = worldRows[0];
  if (!before) return { deal_id: due.deal_id, status: 'skipped', reason: 'world_not_found' };
  if (before.turn_status !== 'open') return { deal_id: due.deal_id, status: 'skipped', reason: `world_${before.turn_status}` };

  try {
    const world = loadPersistentWorld(JSON.stringify(before.save_envelope));
    const transfer = applyExternalTransferToWorld(world, due);
    const envelope = JSON.parse(savePersistentWorld(world));
    const replacement = {
      save_version: envelope.save_version,
      save_checksum: envelope.checksum,
      save_envelope: envelope,
      read_model: buildWorldReadModel(world),
      season_id: world.squad_cycle.season_id,
      season_number: world.season_number,
      phase: world.phase,
      matchday: world.matchday_cycle?.current_matchday ?? before.matchday,
      next_turn_at: before.next_turn_at,
      turn_status: before.turn_status,
      updated_at: new Date().toISOString()
    };

    let atomic;
    try {
      atomic = await service('/rest/v1/rpc/apply_transfer_deal_settlement', {
        method: 'POST',
        body: JSON.stringify({
          p_deal_id: due.deal_id,
          p_expected_checksum: before.save_checksum,
          p_replacement: replacement
        })
      });
    } catch (error) {
      if (await reconcileSettlement(due.deal_id, envelope.checksum).catch(() => false)) {
        return { deal_id: due.deal_id, status: 'completed', reconciled: true, replacement_checksum: envelope.checksum, transfer };
      }
      throw error;
    }

    if (!atomic?.accepted) {
      if (atomic?.reason === 'already_completed' && atomic?.replacement_checksum === envelope.checksum) {
        return { deal_id: due.deal_id, status: 'completed', idempotent: true, replacement_checksum: envelope.checksum, transfer };
      }
      return { deal_id: due.deal_id, status: 'skipped', reason: atomic?.reason || 'checkpoint_changed_or_busy' };
    }
    return { deal_id: due.deal_id, status: 'completed', replacement_checksum: envelope.checksum, transfer };
  } catch (error) {
    if (deterministicSettlementError(error)) {
      await failDeal(due.deal_id, error).catch(() => {});
      return { deal_id: due.deal_id, status: 'application_failed', reason: error.message };
    }
    return { deal_id: due.deal_id, status: 'retry', reason: error.message };
  }
}

export async function settleDueExternalTransfers({ worldId = null, limit = 10 } = {}) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return { configured: false, processed: [] };
  const due = await service('/rest/v1/rpc/get_due_external_transfer_settlements', {
    method: 'POST',
    body: JSON.stringify({ p_world_id: worldId, p_limit: limit })
  });
  const processed = [];
  for (const row of Array.isArray(due) ? due : []) processed.push(await settleOne(row));
  return { configured: true, due: Array.isArray(due) ? due.length : 0, processed };
}
