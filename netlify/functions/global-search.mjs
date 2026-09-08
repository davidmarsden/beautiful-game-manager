const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const isJwt = (value) => String(value || '').split('.').length === 3;
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
});
const tokenOf = (request) => {
  const header = request.headers.get('authorization') || '';
  return header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
};
const text = (value) => String(value ?? '').trim();
const norm = (value) => text(value)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

async function supabase(path, token) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}`, accept: 'application/json' }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || body.error || `Supabase returned ${response.status}`);
  return body;
}

async function service(path) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      ...(isJwt(SUPABASE_SERVICE_ROLE_KEY) ? { authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } : {}),
      accept: 'application/json'
    }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || body.error || `Supabase returned ${response.status}`);
  return body;
}

function score(query, values) {
  const q = norm(query);
  let best = 0;
  for (const value of values.map(norm).filter(Boolean)) {
    if (value === q) best = Math.max(best, 1000);
    else if (value.startsWith(q)) best = Math.max(best, 700 - Math.min(200, value.length - q.length));
    else if (value.split(' ').some((word) => word.startsWith(q))) best = Math.max(best, 500);
    else if (value.includes(q)) best = Math.max(best, 300);
  }
  return best;
}

function playerResult(playerId, player, clubProfiles) {
  const clubId = text(player.club_id || player.tbg_club_id || player.current_club_id);
  const club = clubId ? clubProfiles[clubId] || {} : {};
  const displayName = text(player.display_name || player.player_name || player.canonical_name || player.full_name || player.name || playerId);
  const canonicalName = text(player.canonical_name || player.full_name || player.player_name || player.display_name || player.name);
  const snapshot = {
    tbg_player_id: text(player.tbg_player_id || player.player_id || player.id || playerId),
    player_id: text(player.player_id || player.tbg_player_id || player.id || playerId),
    display_name: displayName,
    canonical_name: canonicalName || displayName,
    club_id: clubId || null,
    club_name: text(club.club_name || club.name || player.club_name) || null,
    age: player.age ?? player.season_start_age ?? null,
    nationality: player.nationality || player.country || null,
    specific_position: player.specific_position || player.position_detail || null,
    position: player.position || player.primary_position || player.position_group || null,
    underlying_ability_rating: player.underlying_ability_rating ?? player.tbg_rating ?? player.rating ?? null,
    tbg_rating: player.tbg_rating ?? player.underlying_ability_rating ?? player.rating ?? null,
    fitness: player.fitness ?? null,
    morale: player.morale ?? null,
    injury_status: player.injury_status || player.availability || null,
    availability: player.availability || player.injury_status || null,
    registered: player.registered ?? null,
    registration_status: player.registration_status || null,
    contract_expiry: player.contract_expiry || player.contract_end_at || player.contract?.end_at || null,
    profile_url: player.profile_url || player.pink_final_profile_url || null,
    pink_final_profile_url: player.pink_final_profile_url || player.profile_url || null
  };
  return {
    type: 'player',
    id: snapshot.tbg_player_id,
    name: displayName,
    secondary: [snapshot.position, snapshot.club_name || (player.assignment_status === 'external' ? player.external_club_name : 'Free agent')].filter(Boolean).join(' · '),
    player: snapshot,
    club: clubId ? { club_id: clubId, club_name: snapshot.club_name || clubId } : { club_name: player.external_club_name || 'Free agent' }
  };
}

function clubResult(clubId, club) {
  const name = text(club.club_name || club.name || club.canonical_name || clubId);
  return {
    type: 'club',
    id: clubId,
    name,
    secondary: [club.short_name, club.division_name || club.division_id].filter(Boolean).join(' · '),
    club: { club_id: clubId, club_name: name, canonical_name: club.canonical_name || name }
  };
}

export default async (request) => {
  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'Supabase is not configured' }, 503);
    const token = tokenOf(request);
    if (!token) return json({ error: 'Authentication required' }, 401);
    const query = text(new URL(request.url).searchParams.get('q')).slice(0, 120);
    if (query.length < 2) return json({ query, results: [] });

    const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}` }
    });
    if (!userResponse.ok) return json({ error: 'Session is invalid or expired' }, 401);
    const user = await userResponse.json();
    const profiles = await supabase(`/rest/v1/manager_profiles?user_id=eq.${encodeURIComponent(user.id)}&select=id&limit=1`, token);
    const manager = profiles[0];
    if (!manager) return json({ error: 'Manager profile has not been created yet' }, 409);
    const appointments = await supabase(`/rest/v1/manager_appointments?manager_id=eq.${encodeURIComponent(manager.id)}&status=eq.active&select=world_id&limit=1`, token);
    const appointment = appointments[0];
    if (!appointment) return json({ error: 'No active club appointment' }, 409);

    const worldId = encodeURIComponent(appointment.world_id);
    const [readRows, canonicalRows] = await Promise.all([
      service(`/rest/v1/world_read_model_cache?world_id=eq.${worldId}&select=read_model,source_checksum&limit=1`),
      service(`/rest/v1/canonical_world_saves?world_id=eq.${worldId}&select=save_checksum&limit=1`)
    ]);
    const readRow = readRows[0];
    const canonicalRow = canonicalRows[0];
    if (!readRow?.read_model || !canonicalRow?.save_checksum || readRow.source_checksum !== canonicalRow.save_checksum) {
      return json({ error: 'World read model is refreshing; please retry shortly' }, 503);
    }

    const world = readRow.read_model;
    const clubProfiles = world.club_profiles || {};
    const ranked = [];
    for (const [clubId, club] of Object.entries(clubProfiles)) {
      const result = clubResult(clubId, club || {});
      const rank = score(query, [result.name, club?.short_name, club?.canonical_name, clubId]);
      if (rank) ranked.push({ rank: rank + 20, result });
    }
    for (const [playerId, player] of Object.entries(world.squad_cycle?.players || {})) {
      const result = playerResult(playerId, player || {}, clubProfiles);
      const rank = score(query, [result.name, result.player.canonical_name, player?.known_as, player?.short_name, playerId]);
      if (rank) ranked.push({ rank: rank + 10, result });
    }

    ranked.sort((a, b) => b.rank - a.rank || a.result.name.localeCompare(b.result.name, 'en'));
    return json({ query, results: ranked.slice(0, 30).map(({ result }) => result), canonical_source: canonicalRow.save_checksum });
  } catch (error) {
    return json({ error: error.message || 'Global search failed' }, 503);
  }
};
