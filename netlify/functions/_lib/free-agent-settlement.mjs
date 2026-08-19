import { createHash } from 'node:crypto';
import { loadPersistentWorld, savePersistentWorld } from '../../../src/world/persistentSeasonLoop.js';
import { acquireFreeAgent } from '../../../src/squadCycle/freeAgentAcquisition.js';
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

function requestKey({ userId, worldId, playerId, contractYears, wage, clientRequestId }) {
  return createHash('sha256').update(JSON.stringify({
    user_id: userId,
    world_id: worldId,
    action: 'sign_free_agent',
    player_id: playerId,
    contract_years: contractYears,
    wage,
    client_request_id: clientRequestId
  })).digest('hex');
}

function assertNoTransfermarktDuplicate(world, player) {
  const tmId = String(player?.transfermarkt_id || player?.transfermarktId || '').trim();
  if (!tmId) return;
  const duplicate = Object.values(world?.squad_cycle?.players || {}).find((row) =>
    String(row?.transfermarkt_id || row?.transfermarktId || '').trim() === tmId
  );
  if (duplicate) throw new Error(`Transfermarkt ID ${tmId} already exists in the world`);
}

function projectNewPlayer(world, player, clubId) {
  if (Array.isArray(world.player_ownership)) {
    const exists = world.player_ownership.some((row) => String(row?.tbg_player_id || row?.player_id || row?.id || '') === String(player.tbg_player_id));
    if (!exists) world.player_ownership.push({
      tbg_player_id: player.tbg_player_id,
      player_id: player.tbg_player_id,
      club_id: clubId,
      transfermarkt_id: player.transfermarkt_id || null
    });
  }
}

function deterministicApplicationError(error) {
  return /Transfer window is closed|Unknown club|already exists in the world|already belongs to|not a free agent|not in active circulation|Transfermarkt ID .* already exists|registration limit reached|first-team squad limit reached|youth squad limit reached|Registration is closed|Contract end must be after|Cannot save invalid world/i.test(String(error?.message || error));
}

function normaliseNonNegativeInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : fallback;
}

async function reconcile(acquisitionId, replacementChecksum) {
  const rows = await service(`/rest/v1/player_acquisitions?id=eq.${encodeURIComponent(acquisitionId)}&select=id,status,replacement_checksum&limit=1`);
  const row = rows[0];
  return Boolean(row?.status === 'completed' && row?.replacement_checksum === replacementChecksum);
}

async function fail(acquisitionId, error) {
  return service('/rest/v1/rpc/fail_free_agent_acquisition', {
    method: 'POST',
    body: JSON.stringify({ p_acquisition_id: acquisitionId, p_reason: String(error?.message || error) })
  });
}

export async function signFreeAgent({
  userId,
  worldId,
  player,
  contractYears = 3,
  wage = 1000,
  clientRequestId
} = {}) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error('Free-agent settlement is not configured');
  const playerId = String(player?.tbg_player_id || player?.player_id || '').trim();
  if (!playerId) throw new Error('Player is required');
  const safeYears = Math.max(1, Math.min(5, Number(contractYears) || 3));
  const safeWage = normaliseNonNegativeInteger(wage, 1000);
  const key = requestKey({ userId, worldId, playerId, contractYears: safeYears, wage: safeWage, clientRequestId });

  const acquisition = await service('/rest/v1/rpc/create_free_agent_acquisition_for_user', {
    method: 'POST',
    body: JSON.stringify({
      p_user_id: userId,
      p_world_id: worldId,
      p_player_id: playerId,
      p_transfermarkt_id: String(player.transfermarkt_id || '').trim() || null,
      p_player_name: String(player.display_name || player.full_name || playerId),
      p_player_snapshot: player,
      p_contract_years: safeYears,
      p_wage: safeWage,
      p_request_key: key
    })
  });

  if (!acquisition?.accepted) return acquisition;
  if (acquisition.status === 'completed') {
    return { ...acquisition, accepted: true, idempotent: true };
  }
  if (acquisition.status === 'application_failed') {
    return { ...acquisition, accepted: false, reason: 'application_failed' };
  }

  const acquisitionId = acquisition.acquisition_id;
  const worldRows = await service(`/rest/v1/canonical_world_saves?world_id=eq.${encodeURIComponent(worldId)}&select=*`);
  const before = worldRows[0];
  if (!before) throw new Error('Canonical world not found');
  if (before.turn_status !== 'open') return { accepted: false, acquisition_id: acquisitionId, reason: `world_${before.turn_status}` };

  try {
    const world = loadPersistentWorld(JSON.stringify(before.save_envelope));
    const at = new Date(world.clock).toISOString();
    assertNoTransfermarktDuplicate(world, player);
    const signed = acquireFreeAgent(world.squad_cycle, {
      player,
      toClubId: acquisition.club_id,
      at,
      contractEndAt: addYears(at, safeYears),
      wage: safeWage
    });
    projectNewPlayer(world, signed.player, acquisition.club_id);

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
      atomic = await service('/rest/v1/rpc/apply_free_agent_acquisition_settlement', {
        method: 'POST',
        body: JSON.stringify({
          p_acquisition_id: acquisitionId,
          p_expected_checksum: before.save_checksum,
          p_replacement: replacement
        })
      });
    } catch (error) {
      if (await reconcile(acquisitionId, envelope.checksum).catch(() => false)) {
        return {
          accepted: true,
          acquisition_id: acquisitionId,
          status: 'completed',
          reconciled: true,
          replacement_checksum: envelope.checksum,
          player: signed.player
        };
      }
      throw error;
    }

    if (!atomic?.accepted) {
      if (atomic?.reason === 'already_completed' && atomic?.replacement_checksum === envelope.checksum) {
        return {
          accepted: true,
          acquisition_id: acquisitionId,
          status: 'completed',
          idempotent: true,
          replacement_checksum: envelope.checksum,
          player: signed.player
        };
      }
      return { accepted: false, acquisition_id: acquisitionId, reason: atomic?.reason || 'checkpoint_changed_or_busy' };
    }

    return {
      accepted: true,
      acquisition_id: acquisitionId,
      status: 'completed',
      previous_checksum: before.save_checksum,
      replacement_checksum: envelope.checksum,
      player: signed.player,
      contract: signed.contract
    };
  } catch (error) {
    if (deterministicApplicationError(error)) {
      await fail(acquisitionId, error).catch(() => {});
      return { accepted: false, acquisition_id: acquisitionId, status: 'application_failed', reason: error.message };
    }
    throw error;
  }
}
