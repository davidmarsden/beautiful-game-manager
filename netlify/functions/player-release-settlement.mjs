import { loadPersistentWorld, savePersistentWorld } from '../../src/world/persistentSeasonLoop.js';
import { buildWorldReadModel } from '../../src/world/worldReadModel.js';
import { applyPublishedPlayerReleases } from '../../src/world/playerDataRelease.js';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const RELEASE_HISTORY_URL = process.env.TBG_PLAYER_RELEASE_HISTORY_URL || 'https://raw.githubusercontent.com/davidmarsden/beautiful-game-data/main/derived/player-changes/player-release-history.json';

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

async function releaseHistory() {
  const response = await fetch(RELEASE_HISTORY_URL, { headers: { accept: 'application/json', 'cache-control': 'no-cache' }, cache: 'no-store' });
  if (!response.ok) throw new Error(`Player release history unavailable (HTTP ${response.status})`);
  const history = await response.json();
  if (!Array.isArray(history?.releases)) throw new Error('Player release history is malformed');
  return history;
}

function replacementFor(world, before) {
  const envelope = JSON.parse(savePersistentWorld(world));
  return {
    envelope,
    replacement: {
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
    }
  };
}

async function settleWorld(before, history) {
  if (before.turn_status !== 'open') return { world_id: before.world_id, accepted: false, reason: `world_${before.turn_status}` };
  const world = loadPersistentWorld(JSON.stringify(before.save_envelope));
  const summary = applyPublishedPlayerReleases(world, history);
  if (!summary.releases_applied.length) return { world_id: before.world_id, accepted: true, unchanged: true, ...summary };

  const { envelope, replacement } = replacementFor(world, before);
  const result = await service('/rest/v1/rpc/apply_player_data_release_settlement', {
    method: 'POST',
    body: JSON.stringify({
      p_world_id: before.world_id,
      p_expected_checksum: before.save_checksum,
      p_replacement: replacement,
      p_release_ids: summary.releases_applied
    })
  });
  return {
    world_id: before.world_id,
    ...summary,
    accepted: Boolean(result?.accepted),
    reason: result?.reason || null,
    previous_checksum: before.save_checksum,
    replacement_checksum: result?.accepted ? envelope.checksum : null
  };
}

export default async () => {
  const now = new Date().toISOString();
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: 'Player release settlement is not configured' }), { status: 503, headers: { 'content-type': 'application/json' } });
  }
  try {
    const [history, worlds] = await Promise.all([
      releaseHistory(),
      service('/rest/v1/canonical_world_saves?select=*&order=world_id.asc')
    ]);
    const results = [];
    for (const world of worlds) {
      try {
        results.push(await settleWorld(world, history));
      } catch (error) {
        results.push({ world_id: world.world_id, accepted: false, error: error.message });
      }
    }
    const failed = results.filter((row) => !row.accepted && !String(row.reason || '').startsWith('world_'));
    return new Response(JSON.stringify({ accepted: failed.length === 0, checked_at: now, release_count: history.releases.length, results }), {
      status: failed.length ? 503 : 200,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message, checked_at: now }), { status: 503, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  }
};
