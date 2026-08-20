import { submitFreeAgentOffer, freeAgentOfferExpectation } from './_lib/free-agent-offers.mjs';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const APIFY_TOKEN = process.env.APIFY_TOKEN || '';
const APIFY_ACTOR = process.env.TBG_TRANSFERMARKT_APIFY_ACTOR || 'jungle_synthesizer/transfermarkt-global-football-player-scraper';
const PLAYER_DATABASE_URL = process.env.TBG_PLAYER_DATABASE_URL || 'https://raw.githubusercontent.com/davidmarsden/beautiful-game-data/main/derived/player-database/player-database.json';
const PLAYER_DATABASE_CACHE_MS = Math.max(5000, Number(process.env.TBG_PLAYER_DATABASE_CACHE_MS) || 30000);
const isJwt = (value) => String(value || '').split('.').length === 3;
let playerDatabasePromise = null;
let playerDatabaseLoadedAt = 0;

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
});

const bearerToken = (request) => {
  const header = request.headers.get('authorization') || '';
  return header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
};

async function supabase(path, { service = false, token = '', ...options } = {}) {
  const apiKey = service ? SUPABASE_SERVICE_ROLE_KEY : SUPABASE_ANON_KEY;
  const bearer = service && isJwt(SUPABASE_SERVICE_ROLE_KEY) ? SUPABASE_SERVICE_ROLE_KEY : token;
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: {
      apikey: apiKey,
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
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

async function identity(token) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}` }
  });
  if (!response.ok) throw new Error('Session is invalid or expired');
  const user = await response.json();
  const profiles = await supabase(`/rest/v1/manager_profiles?user_id=eq.${encodeURIComponent(user.id)}&select=id&limit=1`, { token });
  const manager = profiles[0];
  if (!manager) throw new Error('Manager profile has not been created yet');
  const appointments = await supabase(`/rest/v1/manager_appointments?manager_id=eq.${encodeURIComponent(manager.id)}&status=eq.active&select=world_id,club_id&limit=1`, { token });
  const appointment = appointments[0];
  if (!appointment) throw new Error('No active club appointment');
  return { user, manager, appointment };
}

function canonicalId(tmId) {
  return `tbg-tm-${String(tmId).padStart(8, '0')}`;
}

async function playerDatabase({ force = false } = {}) {
  const fresh = playerDatabasePromise && Date.now() - playerDatabaseLoadedAt < PLAYER_DATABASE_CACHE_MS;
  if (force || !fresh) {
    playerDatabaseLoadedAt = Date.now();
    playerDatabasePromise = fetch(PLAYER_DATABASE_URL, {
      headers: { accept: 'application/json', 'cache-control': 'no-cache' },
      cache: 'no-store'
    }).then(async (response) => {
      if (!response.ok) throw new Error(`Player database unavailable (HTTP ${response.status})`);
      const rows = await response.json();
      return Array.isArray(rows) ? rows : [];
    }).catch((error) => {
      playerDatabasePromise = null;
      playerDatabaseLoadedAt = 0;
      throw error;
    });
  }
  return playerDatabasePromise;
}

function positionGroup(position = '') {
  const value = String(position).toLowerCase();
  if (value.includes('goalkeeper') || value === 'gk') return 'GK';
  if (value.includes('back') || value.includes('defender') || value.startsWith('d')) return 'DEF';
  if (value.includes('midfield') || value.startsWith('m')) return 'MID';
  if (value.includes('wing') || value.includes('forward') || value.includes('striker') || value.startsWith('f') || value.startsWith('am')) return 'ATT';
  return 'UNK';
}

function ratedExternalPlayer(row, tmId) {
  const rating = Number(row?.tbg_rating ?? row?.underlying_ability_rating ?? 0);
  if (!rating) return null;
  const value = Math.max(0, Number(row.market_value_eur) || 0);
  return {
    tbg_player_id: String(row.tbg_player_id || canonicalId(tmId)),
    transfermarkt_id: String(tmId),
    display_name: row.player_name || row.display_name || row.full_name || canonicalId(tmId),
    full_name: row.full_name || row.player_name || row.display_name || canonicalId(tmId),
    age: row.age == null ? null : Number(row.age),
    date_of_birth: row.date_of_birth || null,
    nationality: Array.isArray(row.nationality) ? row.nationality : String(row.nationality || '').split(';').map((value) => value.trim()).filter(Boolean),
    position: row.position || row.primary_position || '',
    position_group: row.position_group || positionGroup(row.position || row.primary_position),
    market_value_eur: value,
    tbg_rating: rating,
    underlying_ability_rating: rating,
    rating_band: row.rating_band || null,
    status: row.status || 'active',
    active_circulation: row.active_circulation !== false,
    assignment_status: 'external',
    acquisition_type: 'external_transfermarkt',
    external_acquisition_fee_eur: value,
    real_world_club: row.current_club || '',
    current_club: row.current_club || '',
    source: row.source || 'beautiful-game-data/player-database'
  };
}

async function resolveRated(tmId, { force = false } = {}) {
  const rows = await playerDatabase({ force });
  const row = rows.find((candidate) => String(candidate.transfermarkt_id || candidate.transfermarkt_player_id || '') === String(tmId));
  return row ? ratedExternalPlayer(row, tmId) : null;
}

async function assertNotInWorld(worldId, player) {
  const encodedWorldId = encodeURIComponent(worldId);
  const [cacheRows, canonicalRows] = await Promise.all([
    supabase(`/rest/v1/world_read_model_cache?world_id=eq.${encodedWorldId}&select=read_model,source_checksum&limit=1`, { service: true }),
    supabase(`/rest/v1/canonical_world_saves?world_id=eq.${encodedWorldId}&select=save_checksum&limit=1`, { service: true })
  ]);
  const cacheRow = cacheRows[0];
  const canonicalRow = canonicalRows[0];
  if (!cacheRow?.read_model || !canonicalRow?.save_checksum || cacheRow.source_checksum !== canonicalRow.save_checksum) {
    throw new Error('World read model is refreshing; please retry shortly');
  }
  const players = cacheRow.read_model?.squad_cycle?.players;
  if (!players || typeof players !== 'object' || Array.isArray(players)) {
    throw new Error('World read model is refreshing; please retry shortly');
  }
  const canonicalPlayerId = String(player?.tbg_player_id || '').trim();
  const transfermarktId = String(player?.transfermarkt_id || '').trim();
  const duplicate = (canonicalPlayerId && players[canonicalPlayerId]) || Object.values(players).find((candidate) =>
    transfermarktId && String(candidate?.transfermarkt_id || candidate?.transfermarktId || '').trim() === transfermarktId
  );
  if (duplicate) throw new Error('Player is already registered to a club in this TBG world');
}

async function importRow(tmId) {
  const rows = await supabase(`/rest/v1/external_player_imports?transfermarkt_id=eq.${encodeURIComponent(tmId)}&select=*&limit=1`, { service: true });
  return rows[0] || null;
}

async function patchImport(id, values) {
  const rows = await supabase(`/rest/v1/external_player_imports?id=eq.${encodeURIComponent(id)}`, {
    service: true,
    method: 'PATCH',
    body: JSON.stringify({ ...values, updated_at: new Date().toISOString() })
  });
  return rows[0] || null;
}

function apifyActorId() {
  return APIFY_ACTOR.replace('/', '~');
}

async function startApifyImport(tmId) {
  if (!APIFY_TOKEN) throw new Error('External Transfermarkt import is not configured: APIFY_TOKEN is missing');
  const response = await fetch(`https://api.apify.com/v2/acts/${encodeURIComponent(apifyActorId())}/runs?token=${encodeURIComponent(APIFY_TOKEN)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      playerIds: [String(tmId)],
      maxItems: 5,
      proxyConfiguration: { useApifyProxy: true }
    })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body?.data?.id) throw new Error(body?.error?.message || `Apify import could not start (HTTP ${response.status})`);
  return body.data;
}

async function restartImport(row, tmId, userId) {
  const run = await startApifyImport(tmId);
  return patchImport(row.id, {
    status: 'scraping',
    requested_by_user_id: userId,
    apify_run_id: run.id,
    apify_dataset_id: run.defaultDatasetId || null,
    player_snapshot: null,
    error: null,
    completed_at: null
  });
}

function scrapedSnapshot(item, tmId) {
  return {
    tbg_player_id: canonicalId(tmId),
    transfermarkt_id: String(tmId),
    display_name: item.display_name || item.short_name || item.full_name || canonicalId(tmId),
    full_name: item.full_name || item.display_name || item.short_name || canonicalId(tmId),
    age: item.age ?? null,
    date_of_birth: item.date_of_birth || null,
    nationality: Array.isArray(item.nationality) ? item.nationality : [item.nationality].filter(Boolean),
    position: item.position || '',
    position_group: positionGroup(item.position || item.position_category),
    market_value_eur: Math.max(0, Number(item.market_value_eur) || 0),
    status: item.status || item.player_status || 'active',
    active_circulation: !/retired/i.test(String(item.status || item.player_status || '')),
    assignment_status: 'external',
    acquisition_type: 'external_transfermarkt',
    real_world_club: item.current_club || '',
    current_club: item.current_club || '',
    profile_url: item.profile_url || '',
    scraped_at: item.scraped_at || new Date().toISOString(),
    source: item.source || 'apify-transfermarkt-global-player-scraper'
  };
}

async function refreshImport(row) {
  if (!row?.apify_run_id || !APIFY_TOKEN || !['requested', 'scraping'].includes(row.status)) return row;
  const response = await fetch(`https://api.apify.com/v2/actor-runs/${encodeURIComponent(row.apify_run_id)}?token=${encodeURIComponent(APIFY_TOKEN)}`);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) return row;
  const run = body?.data || {};
  if (['FAILED', 'ABORTED', 'TIMED-OUT'].includes(run.status)) {
    return patchImport(row.id, { status: 'failed', error: `Apify run ${run.status.toLowerCase()}`, completed_at: new Date().toISOString() });
  }
  if (run.status !== 'SUCCEEDED') return row;
  const datasetId = run.defaultDatasetId || row.apify_dataset_id;
  const dataset = await fetch(`https://api.apify.com/v2/datasets/${encodeURIComponent(datasetId)}/items?token=${encodeURIComponent(APIFY_TOKEN)}&clean=true&format=json&limit=10`);
  const items = await dataset.json().catch(() => []);
  const exact = (Array.isArray(items) ? items : []).find((item) => String(item.transfermarkt_id ?? item.player_id ?? '') === String(row.transfermarkt_id)) || items?.[0];
  if (!exact) return patchImport(row.id, { status: 'failed', error: 'Transfermarkt player was not returned by the targeted scrape', completed_at: new Date().toISOString() });
  return patchImport(row.id, {
    status: 'scraped',
    apify_dataset_id: datasetId,
    player_snapshot: scrapedSnapshot(exact, row.transfermarkt_id),
    error: null,
    completed_at: new Date().toISOString()
  });
}

async function readyResult(tmId, current, rated) {
  if (/retired/i.test(String(rated.status))) return { status: 'unavailable', reason: 'retired', player: rated };
  await assertNotInWorld(current.appointment.world_id, rated);
  const existing = await importRow(tmId).catch(() => null);
  if (existing && existing.status !== 'ready') {
    await patchImport(existing.id, { status: 'ready', player_snapshot: rated, error: null, completed_at: new Date().toISOString() }).catch(() => {});
  }
  return { status: 'ready', player: rated, acquisition_fee_eur: rated.external_acquisition_fee_eur, expected_wage: freeAgentOfferExpectation(rated) };
}

async function lookup(tmId, current) {
  let rated = await resolveRated(tmId);
  if (rated) return readyResult(tmId, current, rated);

  let row = await importRow(tmId).catch(() => null);
  if (row) row = await refreshImport(row).catch(() => row);

  // A scraped row means the data pipeline may have published a rating since this
  // warm function last read the governed database. Force a no-cache revalidation
  // so “Check rating status” can observe that publication immediately.
  if (row?.status === 'scraped') {
    rated = await resolveRated(tmId, { force: true });
    if (rated) return readyResult(tmId, current, rated);
  }

  return {
    status: row?.status || 'not_imported',
    import: row ? {
      id: row.id,
      status: row.status,
      transfermarkt_id: row.transfermarkt_id,
      error: row.error,
      player_snapshot: row.player_snapshot,
      created_at: row.created_at,
      updated_at: row.updated_at
    } : null,
    rating_required: row?.status === 'scraped',
    message: row?.status === 'scraped'
      ? 'Transfermarkt data has been imported. Acquisition is waiting for the governed TBG rating pipeline to publish an Ability rating.'
      : row?.status === 'failed'
        ? 'The targeted import failed. You can retry the import.'
        : 'This TM ID is not yet in the governed TBG player database.'
  };
}

function normaliseNonNegativeInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : fallback;
}

export default async (request) => {
  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'Supabase is not configured' }, 503);
    if (!['GET', 'POST'].includes(request.method)) return json({ error: 'Method not allowed' }, 405);
    const token = bearerToken(request);
    if (!token) return json({ error: 'Authentication required' }, 401);
    const current = await identity(token);
    const url = new URL(request.url);
    const body = request.method === 'POST' ? await request.json().catch(() => ({})) : {};
    const tmId = String(body.transfermarkt_id || body.transfermarktId || url.searchParams.get('tm_id') || '').trim();
    if (!/^\d+$/.test(tmId)) return json({ error: 'A numeric Transfermarkt ID is required' }, 400);

    if (request.method === 'GET') return json({ transfermarkt_id: tmId, ...(await lookup(tmId, current)) });

    const action = String(body.action || '').trim().toLowerCase();
    if (action === 'request_import') {
      const known = await resolveRated(tmId, { force: true });
      if (known) return json({ transfermarkt_id: tmId, status: 'ready', player: known, already_known: true });
      let row = await importRow(tmId);
      if (row) {
        row = await refreshImport(row).catch(() => row);
        if (row?.status === 'failed') {
          row = await restartImport(row, tmId, current.user.id);
          return json({ transfermarkt_id: tmId, status: 'scraping', import: row, retried: true, message: 'Targeted Transfermarkt import restarted.' }, 202);
        }
        return json({ transfermarkt_id: tmId, status: row.status, import: row, idempotent: true });
      }
      const run = await startApifyImport(tmId);
      const rows = await supabase('/rest/v1/external_player_imports', {
        service: true,
        method: 'POST',
        body: JSON.stringify({
          transfermarkt_id: tmId,
          status: 'scraping',
          requested_by_user_id: current.user.id,
          apify_run_id: run.id,
          apify_dataset_id: run.defaultDatasetId || null
        })
      });
      return json({ transfermarkt_id: tmId, status: 'scraping', import: rows[0], message: 'Targeted Transfermarkt import started.' }, 202);
    }

    if (action === 'offer') {
      const player = await resolveRated(tmId, { force: true });
      if (!player) return json({ error: 'This external player does not yet have a governed TBG Ability rating', reason: 'rating_required' }, 409);
      if (/retired/i.test(String(player.status))) return json({ error: 'This player is retired and cannot be acquired' }, 409);
      await assertNotInWorld(current.appointment.world_id, player);
      const contractYears = Math.max(1, Math.min(5, Number(body.contract_years ?? body.contractYears ?? 3) || 3));
      const wage = normaliseNonNegativeInteger(body.wage, freeAgentOfferExpectation(player));
      const result = await submitFreeAgentOffer({
        userId: current.user.id,
        worldId: current.appointment.world_id,
        player,
        contractYears,
        wage,
        clientRequestId: String(body.client_request_id || body.clientRequestId || '').trim() || `${Date.now()}-${player.tbg_player_id}`
      });
      return json({
        accepted: true,
        action: 'offer',
        source: 'external_transfermarkt',
        acquisition_fee_eur: player.external_acquisition_fee_eur,
        expected_wage: freeAgentOfferExpectation(player),
        decision_at: result.decision_at,
        offer: result,
        player
      });
    }

    return json({ error: 'Unsupported external-market action' }, 400);
  } catch (error) {
    const message = String(error?.message || 'External-market request failed');
    const status = /Session|Authentication/.test(message) ? 401
      : /already registered|retired|rating/i.test(message) ? 409
        : /refreshing|not configured|unavailable|Apify/i.test(message) ? 503 : 500;
    return json({ error: message }, status);
  }
};