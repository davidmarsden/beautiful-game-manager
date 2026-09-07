const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const PLAYER_DATABASE_URL = process.env.TBG_PLAYER_DATABASE_URL || 'https://raw.githubusercontent.com/davidmarsden/beautiful-game-data/main/derived/player-database/player-database.json';
const PLAYER_DATABASE_CACHE_MS = Math.max(5000, Number(process.env.TBG_PLAYER_DATABASE_CACHE_MS) || 30000);
const MIN_EXTERNAL_OFFER = 100_000;
const isJwt = (value) => String(value || '').split('.').length === 3;

let playerDatabasePromise = null;
let playerDatabaseLoadedAt = 0;

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

async function playerDatabase() {
  const fresh = playerDatabasePromise && Date.now() - playerDatabaseLoadedAt < PLAYER_DATABASE_CACHE_MS;
  if (!fresh) {
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

function normalise(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function stableHash(value) {
  let result = 2166136261;
  for (const character of String(value || '')) {
    result ^= character.charCodeAt(0);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function roundMoney(value) {
  const amount = Math.max(MIN_EXTERNAL_OFFER, Number(value) || 0);
  return Math.max(MIN_EXTERNAL_OFFER, Math.round(amount / 1000) * 1000);
}

export function governedExternalOffer({ marketValue = 0, askingFee = 0, seed = '' } = {}) {
  const fairValue = Math.max(MIN_EXTERNAL_OFFER, Number(marketValue) || 0);
  const floor = fairValue * 0.90;
  const ceiling = fairValue * 1.10;
  const requested = Number(askingFee) > 0 ? Number(askingFee) : fairValue;
  const boundedAsk = Math.max(floor, Math.min(ceiling, requested));
  const modifier = 0.95 + (stableHash(seed) % 11) / 100;
  return roundMoney(Math.max(floor, Math.min(ceiling, boundedAsk * modifier)));
}

function playerId(row) {
  return String(row?.tbg_player_id || '').trim();
}

function clubSourceId(row) {
  const id = String(row?.current_club_id || row?.real_club_source_id || row?.transfermarkt_club_id || '').trim();
  const name = String(row?.current_club || '').trim();
  return id || (name ? `name:${normalise(name)}` : '');
}

function clubName(row) {
  return String(row?.current_club || '').trim();
}

function usableClubName(value) {
  const name = String(value || '').trim();
  return Boolean(name && !/^(without club|retired|unknown|n\/a|-|—)$/i.test(name));
}

function managedClubNames(readModel, rows = []) {
  const names = new Set();
  for (const profile of Object.values(readModel?.club_profiles || {})) {
    const name = profile?.club_name || profile?.canonical_name;
    if (name) names.add(normalise(name));
  }
  for (const club of Object.values(readModel?.squad_cycle?.clubs || {})) {
    const name = club?.club_name || club?.canonical_name;
    if (name) names.add(normalise(name));
  }
  // TPF's own managed-club assignment is an additional alias guard: a current
  // real-world club that is one of the 80 must never bid as an external club just
  // because its display spelling differs slightly from the world read model.
  for (const row of rows) {
    if (row?.tbg_club) names.add(normalise(row.tbg_club));
  }
  return names;
}

function externalClubUniverse(rows, managedNames) {
  const clubs = new Map();
  for (const row of rows) {
    const name = clubName(row);
    const sourceId = clubSourceId(row);
    if (!sourceId || !usableClubName(name) || managedNames.has(normalise(name))) continue;
    const rating = Math.max(0, Number(row?.tbg_rating ?? row?.underlying_ability_rating) || 0);
    const value = Math.max(0, Number(row?.market_value_eur) || 0);
    const existing = clubs.get(sourceId) || { source_id: sourceId, name, max_rating: 0, max_value: 0, player_count: 0 };
    existing.max_rating = Math.max(existing.max_rating, rating);
    existing.max_value = Math.max(existing.max_value, value);
    existing.player_count += 1;
    clubs.set(sourceId, existing);
  }
  return [...clubs.values()];
}

function realLifeExternalClub(row, managedNames) {
  if (!row) return null;
  const name = clubName(row);
  const sourceId = clubSourceId(row);
  if (!sourceId || !usableClubName(name) || managedNames.has(normalise(name))) return null;
  return { source_id: sourceId, name };
}

function suitableExternalClub({ clubs, player, listing, excluded = new Set() }) {
  const rating = Math.max(0, Number(player?.tbg_rating ?? player?.underlying_ability_rating ?? player?.rating) || 0);
  const marketValue = Math.max(0, Number(player?.market_value_eur ?? player?.market_value) || 0);
  const candidates = clubs.filter((club) => !excluded.has(club.source_id));
  candidates.sort((a, b) => {
    const aRatingGap = Math.abs(a.max_rating - rating);
    const bRatingGap = Math.abs(b.max_rating - rating);
    if (aRatingGap !== bRatingGap) return aRatingGap - bRatingGap;
    const aValueGap = Math.abs(Math.log10(Math.max(1, a.max_value)) - Math.log10(Math.max(1, marketValue)));
    const bValueGap = Math.abs(Math.log10(Math.max(1, b.max_value)) - Math.log10(Math.max(1, marketValue)));
    if (aValueGap !== bValueGap) return aValueGap - bValueGap;
    return stableHash(`${listing.world_id}|${listing.player_id}|${a.source_id}`)
      - stableHash(`${listing.world_id}|${listing.player_id}|${b.source_id}`);
  });
  return candidates[0] || null;
}

async function worldReadModel(worldId) {
  const encoded = encodeURIComponent(worldId);
  const [cacheRows, saveRows] = await Promise.all([
    service(`/rest/v1/world_read_model_cache?world_id=eq.${encoded}&select=read_model,source_checksum&limit=1`),
    service(`/rest/v1/canonical_world_saves?world_id=eq.${encoded}&select=save_checksum&limit=1`)
  ]);
  const cache = cacheRows[0];
  const save = saveRows[0];
  if (!cache?.read_model || !save?.save_checksum || cache.source_checksum !== save.save_checksum) {
    throw new Error(`World read model is refreshing for ${worldId}`);
  }
  return cache.read_model;
}

async function createOffer(listing, player, club, kind) {
  const fee = governedExternalOffer({
    marketValue: player?.market_value_eur ?? player?.market_value,
    askingFee: listing.asking_fee,
    seed: `${listing.world_id}|${listing.player_id}|${club.source_id}|${kind}`
  });
  const result = await service('/rest/v1/rpc/create_external_transfer_offer', {
    method: 'POST',
    body: JSON.stringify({
      p_world_id: listing.world_id,
      p_listing_id: listing.id,
      p_external_club_source_id: club.source_id,
      p_external_club_name: club.name,
      p_fee: fee,
      p_contract_years: 3
    })
  });
  return { kind, club, fee, result };
}

export async function generateScheduledExternalOffers({ worldId = null, limit = 20 } = {}) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return { configured: false, processed: [] };
  const rows = await playerDatabase();
  const listings = await service('/rest/v1/rpc/get_external_offer_candidate_listings', {
    method: 'POST',
    body: JSON.stringify({ p_world_id: worldId, p_limit: Math.max(1, Math.min(Number(limit) || 20, 100)) })
  });
  const databaseByPlayer = new Map(rows.map((row) => [playerId(row), row]).filter(([id]) => id));
  const readModels = new Map();
  const processed = [];

  for (const listing of Array.isArray(listings) ? listings : []) {
    try {
      if (!readModels.has(listing.world_id)) readModels.set(listing.world_id, await worldReadModel(listing.world_id));
      const readModel = readModels.get(listing.world_id);
      const tpfPlayer = databaseByPlayer.get(String(listing.player_id)) || null;
      // Missing TPF player metadata is a data-quality fault, not a reason to strand a
      // listed player. Fall back to the canonical TBG projection for market matching.
      const player = tpfPlayer || readModel?.squad_cycle?.players?.[listing.player_id] || { tbg_player_id: listing.player_id };
      const names = managedClubNames(readModel, rows);
      const clubs = externalClubUniverse(rows, names);
      const targets = [];

      // SMW-compatible anchor: when the player's current real-world club is outside
      // the managed TBG world, that real club always makes an offer.
      const realClub = realLifeExternalClub(tpfPlayer, names);
      if (realClub) targets.push({ ...realClub, kind: 'real_life_club' });

      // Every listing must have an acceptable external market. If the real-world club
      // is managed (the common case at launch), select a plausible real TPF club.
      // When the real-world club is external, add one suitable competing club as well.
      const excluded = new Set(targets.map((club) => club.source_id));
      const marketClub = suitableExternalClub({ clubs, player, listing, excluded });
      if (marketClub && (!realClub || marketClub.source_id !== realClub.source_id)) {
        targets.push({ ...marketClub, kind: 'market_match' });
      }

      if (!targets.length) {
        processed.push({ listing_id: listing.id, player_id: listing.player_id, status: 'retry', reason: 'no_external_tpf_club_available' });
        continue;
      }

      const offers = [];
      // Keep the guaranteed real-life-club bid first. If an optional second bid fails,
      // the listing still has its required external market and leaves the candidate queue.
      for (const target of targets) offers.push(await createOffer(listing, player, target, target.kind));
      processed.push({
        listing_id: listing.id,
        player_id: listing.player_id,
        status: 'offered',
        tpf_player_metadata: Boolean(tpfPlayer),
        real_world_club_guaranteed: Boolean(realClub),
        offers: offers.map((offer) => ({
          kind: offer.kind,
          external_club_source_id: offer.club.source_id,
          external_club_name: offer.club.name,
          fee: offer.fee,
          deal_id: offer.result?.deal_id || null
        }))
      });
    } catch (error) {
      processed.push({ listing_id: listing.id, player_id: listing.player_id, status: 'retry', reason: String(error?.message || error) });
    }
  }

  return { configured: true, listings: Array.isArray(listings) ? listings.length : 0, processed };
}
