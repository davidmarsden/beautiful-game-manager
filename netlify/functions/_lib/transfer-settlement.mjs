import { loadPersistentWorld, savePersistentWorld } from '../../../src/world/persistentSeasonLoop.js';
import { transferPlayer } from '../../../src/squadCycle/squadCycle.js';
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

function addYears(value, years) {
  const date = new Date(value);
  date.setUTCFullYear(date.getUTCFullYear() + Number(years || 0));
  return date.toISOString();
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
    if (runtime?.state?.players?.[playerId]) runtime.state.players[playerId].club_id = toClubId;
  }
}

function deterministicSettlementError(error) {
  return /Transfer window is closed|Unknown player|Unknown club|is not owned by|already belongs to|registration limit reached|first-team squad limit reached|youth squad limit reached|Registration is closed|Contract end must be after|Cannot save invalid world/i.test(String(error?.message || error));
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

async function settleOne(due) {
  const worldRows = await service(`/rest/v1/canonical_world_saves?world_id=eq.${encodeURIComponent(due.world_id)}&select=*`);
  const before = worldRows[0];
  if (!before) return { deal_id: due.deal_id, status: 'skipped', reason: 'world_not_found' };
  if (before.turn_status !== 'open') return { deal_id: due.deal_id, status: 'skipped', reason: `world_${before.turn_status}` };

  try {
    const world = loadPersistentWorld(JSON.stringify(before.save_envelope));
    const at = new Date(world.clock).toISOString();
    transferPlayer(world.squad_cycle, {
      playerId: due.player_id,
      fromClubId: due.from_club_id,
      toClubId: due.to_club_id,
      at,
      fee: Number(due.fee || 0),
      contractEndAt: addYears(at, Number(due.contract_years || 3))
    });
    updateOwnershipProjection(world, due.player_id, due.to_club_id);

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
        return { deal_id: due.deal_id, status: 'completed', reconciled: true, replacement_checksum: envelope.checksum };
      }
      throw error;
    }

    if (!atomic?.accepted) {
      if (atomic?.reason === 'already_completed' && atomic?.replacement_checksum === envelope.checksum) {
        return { deal_id: due.deal_id, status: 'completed', idempotent: true, replacement_checksum: envelope.checksum };
      }
      return { deal_id: due.deal_id, status: 'skipped', reason: atomic?.reason || 'checkpoint_changed_or_busy' };
    }
    return { deal_id: due.deal_id, status: 'completed', replacement_checksum: envelope.checksum };
  } catch (error) {
    if (deterministicSettlementError(error)) {
      await failDeal(due.deal_id, error).catch(() => {});
      return { deal_id: due.deal_id, status: 'application_failed', reason: error.message };
    }
    return { deal_id: due.deal_id, status: 'retry', reason: error.message };
  }
}

export async function settleDueTransfers({ worldId = null, limit = 10 } = {}) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return { configured: false, processed: [] };
  const due = await service('/rest/v1/rpc/get_due_transfer_settlements', {
    method: 'POST',
    body: JSON.stringify({ p_world_id: worldId, p_limit: limit })
  });
  const processed = [];
  for (const row of Array.isArray(due) ? due : []) processed.push(await settleOne(row));
  return { configured: true, due: Array.isArray(due) ? due.length : 0, processed };
}
