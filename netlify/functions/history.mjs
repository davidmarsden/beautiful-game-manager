import { loadPersistentWorld } from '../../src/world/persistentSeasonLoop.js';
import { projectPersistentHistory } from '../../src/world/persistentHistoryProjection.js';
import { enrichHistorySquads } from '../../src/world/historySquadProjection.js';
import { projectPinkFinalClubIdentity } from '../../src/world/pinkFinalClubProfile.js';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const PINK_FINAL_BASE_URL = process.env.PINK_FINAL_BASE_URL || undefined;
const PINK_FINAL_CLUB_BASE_URL = process.env.PINK_FINAL_CLUB_BASE_URL || undefined;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const tokenOf = (request) => { const header = request.headers.get('authorization') || ''; return header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : ''; };

async function supabase(path, token) {
  const response = await fetch(`${SUPABASE_URL}${path}`, { headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}`, accept: 'application/json' } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || body.error || `Supabase returned ${response.status}`);
  return body;
}

export default async (request) => {
  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return json({ error: 'Supabase is not configured' }, 503);
    const token = tokenOf(request);
    if (!token) return json({ error: 'Authentication required' }, 401);
    const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}` } });
    if (!userResponse.ok) return json({ error: 'Session is invalid or expired' }, 401);
    const user = await userResponse.json();
    const profiles = await supabase(`/rest/v1/manager_profiles?user_id=eq.${encodeURIComponent(user.id)}&select=id&limit=1`, token);
    const manager = profiles[0];
    if (!manager) return json({ error: 'Manager profile has not been created yet' }, 409);
    const appointments = await supabase(`/rest/v1/manager_appointments?manager_id=eq.${encodeURIComponent(manager.id)}&status=eq.active&select=world_id,club_id&limit=1`, token);
    const appointment = appointments[0];
    if (!appointment) return json({ error: 'No active club appointment' }, 409);
    const saves = await supabase(`/rest/v1/canonical_world_saves?world_id=eq.${encodeURIComponent(appointment.world_id)}&select=save_envelope,save_checksum,updated_at&limit=1`, token);
    if (!saves[0]) return json({ error: 'Canonical world has not been initialized' }, 409);
    const reportRows = await supabase(`/rest/v1/season_match_report_bundles?world_id=eq.${encodeURIComponent(appointment.world_id)}&select=report_store_key,season_id,reports&order=season_id.desc`, token).catch(() => []);
    const world = loadPersistentWorld(JSON.stringify(saves[0].save_envelope));
    const projection = {
      ...projectPersistentHistory(world, {
        managedClubId: appointment.club_id,
        reportBundles: reportRows.map((row) => ({ ...row, reports: row.reports || [] }))
      }),
      pinkFinalBaseUrl: PINK_FINAL_BASE_URL
    };
    const history = enrichHistorySquads(projection, world);
    const clubLinkOptions = PINK_FINAL_CLUB_BASE_URL ? { baseUrl: PINK_FINAL_CLUB_BASE_URL } : {};
    const clubs = Object.fromEntries(Object.entries(history.clubs || {}).map(([clubId, club]) => [clubId, {
      ...club,
      ...projectPinkFinalClubIdentity({ ...world.club_profiles?.[clubId], club_id: clubId }, clubLinkOptions)
    }]));
    return json({
      ...history,
      clubs,
      canonical_source: { checksum: saves[0].save_checksum, updated_at: saves[0].updated_at }
    });
  } catch (error) {
    return json({ error: error.message }, 503);
  }
};
