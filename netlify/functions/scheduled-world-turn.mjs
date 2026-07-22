import { executeScheduledTurn, buildScheduledTurnPlan } from '../../src/world/sharedWorldScheduler.js';
import { executePortalWorldCommand } from '../../src/world/portalWorldControl.js';
import { loadPersistentWorld, savePersistentWorld } from '../../src/world/persistentSeasonLoop.js';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const TURN_DAYS = String(process.env.TBG_TURN_DAYS || '2,5').split(',').map(Number).filter((day) => day >= 0 && day <= 6);
const TURN_HOUR_UTC = Number(process.env.TBG_TURN_HOUR_UTC || 20);

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
});

async function service(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: {
      apikey: SERVICE_ROLE_KEY,
      authorization: `Bearer ${SERVICE_ROLE_KEY}`,
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

export function nextScheduledTurn(after = new Date()) {
  if (!TURN_DAYS.length) throw new Error('TBG_TURN_DAYS has no valid weekdays');
  const start = new Date(after);
  for (let offset = 0; offset <= 8; offset += 1) {
    const candidate = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + offset, TURN_HOUR_UTC, 0, 0, 0));
    if (TURN_DAYS.includes(candidate.getUTCDay()) && candidate > start) return candidate.toISOString();
  }
  throw new Error('Could not resolve the next scheduled turn');
}

export function commandForDomain(row) {
  const payload = row.command_payload || {};
  if (row.command_type === 'register_player') return { type: 'register_player', playerId: payload.playerId || payload.player_id };
  if (row.command_type === 'unregister_player') return { type: 'unregister_player', playerId: payload.playerId || payload.player_id };
  if (row.command_type === 'renew_contract') return { type: 'renew_contract', playerId: payload.playerId || payload.player_id, years: payload.years, wage: payload.wage };

  // Listings, offers and responses are negotiation records, not authority to move a player.
  // A transfer may only become a domain command after a separate agreement resolver has
  // matched the required parties and emitted an explicitly authorised transaction.
  if (row.command_type === 'transfer_offer' || row.command_type === 'transfer_listing' || row.command_type === 'transfer_response') return null;
  return null;
}

function applyPendingCommands(worldInput, rows) {
  let world = loadPersistentWorld(savePersistentWorld(worldInput));
  const originalHumanClubId = world.human_club_id;
  const results = [];
  for (const row of rows) {
    const command = commandForDomain(row);
    if (!command) {
      results.push({ id: row.id, status: 'rejected', error: `Command requires negotiation resolution before application: ${row.command_type}` });
      continue;
    }
    try {
      world.human_club_id = row.club_id;
      const result = executePortalWorldCommand(world, command);
      world = result.world;
      results.push({ id: row.id, status: 'applied', result: result.result });
    } catch (error) {
      results.push({ id: row.id, status: 'rejected', error: error.message });
    }
  }
  world.human_club_id = originalHumanClubId;
  return { world, results };
}

async function processWorld(stored, now) {
  const worldId = stored.world_id;
  const previousChecksum = stored.save_checksum;
  const lockRows = await service(`/rest/v1/canonical_world_saves?world_id=eq.${encodeURIComponent(worldId)}&save_checksum=eq.${encodeURIComponent(previousChecksum)}&turn_status=eq.open`, {
    method: 'PATCH',
    body: JSON.stringify({ turn_status: 'locking', updated_at: now }),
    headers: { prefer: 'return=representation' }
  });
  if (lockRows.length !== 1) return { world_id: worldId, status: 'skipped', reason: 'World was already claimed or changed' };

  let runId = null;
  try {
    let world = loadPersistentWorld(JSON.stringify(stored.save_envelope));
    const seasonId = world.squad_cycle.season_id;
    const matchday = world.matchday_cycle?.current_matchday || 1;
    const submissions = await service(`/rest/v1/manager_turn_submissions?world_id=eq.${encodeURIComponent(worldId)}&season_id=eq.${encodeURIComponent(seasonId)}&matchday=eq.${matchday}&status=eq.submitted&select=*`);
    const commands = await service(`/rest/v1/manager_world_commands?world_id=eq.${encodeURIComponent(worldId)}&status=eq.pending&effective_season_id=eq.${encodeURIComponent(seasonId)}&effective_matchday=eq.${matchday}&select=*&order=submitted_at.asc`);

    const commandRun = applyPendingCommands(world, commands);
    world = commandRun.world;
    const plan = buildScheduledTurnPlan(world, submissions, { scheduledFor: stored.next_turn_at || now, nextTurnAt: nextScheduledTurn(new Date(now)) });

    const runRows = await service('/rest/v1/world_turn_runs', {
      method: 'POST',
      body: JSON.stringify({
        world_id: worldId,
        season_id: seasonId,
        matchday,
        previous_checksum: previousChecksum,
        scheduled_for: stored.next_turn_at || now,
        status: 'processing',
        submission_count: plan.submission_count,
        fallback_count: plan.fallback_count
      })
    });
    runId = runRows[0]?.id || null;

    await service(`/rest/v1/manager_turn_submissions?world_id=eq.${encodeURIComponent(worldId)}&season_id=eq.${encodeURIComponent(seasonId)}&matchday=eq.${matchday}&status=eq.submitted`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'locked', locked_at: now }),
      headers: { prefer: 'return=minimal' }
    });

    const executed = executeScheduledTurn(world, plan);
    const envelope = JSON.parse(executed.saved_world);
    const nextTurnAt = nextScheduledTurn(new Date(now));
    const nextSummary = executed.world.matchday_cycle;
    const replacement = {
      save_version: envelope.save_version,
      save_checksum: envelope.checksum,
      save_envelope: envelope,
      season_id: executed.world.squad_cycle.season_id,
      season_number: executed.world.season_number,
      phase: executed.world.phase,
      matchday: nextSummary?.current_matchday || 1,
      next_turn_at: nextTurnAt,
      turn_status: 'open',
      updated_at: now
    };
    const replaced = await service(`/rest/v1/canonical_world_saves?world_id=eq.${encodeURIComponent(worldId)}&save_checksum=eq.${encodeURIComponent(previousChecksum)}&turn_status=eq.locking`, {
      method: 'PATCH',
      body: JSON.stringify(replacement),
      headers: { prefer: 'return=representation' }
    });
    if (replaced.length !== 1) throw new Error('Canonical world changed during scheduled processing');

    for (const result of commandRun.results) {
      await service(`/rest/v1/manager_world_commands?id=eq.${encodeURIComponent(result.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: result.status, processed_at: now }),
        headers: { prefer: 'return=minimal' }
      });
    }
    await service(`/rest/v1/manager_turn_submissions?world_id=eq.${encodeURIComponent(worldId)}&season_id=eq.${encodeURIComponent(seasonId)}&matchday=eq.${matchday}&status=eq.locked`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'consumed', consumed_at: now }),
      headers: { prefer: 'return=minimal' }
    });
    if (runId) await service(`/rest/v1/world_turn_runs?id=eq.${encodeURIComponent(runId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'complete', next_checksum: envelope.checksum, completed_at: now }),
      headers: { prefer: 'return=minimal' }
    });
    return { world_id: worldId, status: 'complete', season_id: seasonId, matchday, next_turn_at: nextTurnAt, checksum: envelope.checksum };
  } catch (error) {
    await service(`/rest/v1/canonical_world_saves?world_id=eq.${encodeURIComponent(worldId)}&save_checksum=eq.${encodeURIComponent(previousChecksum)}&turn_status=eq.locking`, {
      method: 'PATCH',
      body: JSON.stringify({ turn_status: 'failed', updated_at: now }),
      headers: { prefer: 'return=minimal' }
    }).catch(() => {});
    if (runId) await service(`/rest/v1/world_turn_runs?id=eq.${encodeURIComponent(runId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'failed', error_message: error.message, completed_at: now }),
      headers: { prefer: 'return=minimal' }
    }).catch(() => {});
    return { world_id: worldId, status: 'failed', error: error.message };
  }
}

export default async () => {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return json({ error: 'Scheduled world processing is not configured' }, 503);
  const now = new Date().toISOString();
  const due = await service(`/rest/v1/canonical_world_saves?turn_status=eq.open&next_turn_at=lte.${encodeURIComponent(now)}&select=*`);
  const results = [];
  for (const stored of due) results.push(await processWorld(stored, now));
  return json({ version: 'tbg-scheduled-world-turn-v1.0', checked_at: now, worlds_due: due.length, results });
};

export const config = { schedule: '*/15 * * * *' };
