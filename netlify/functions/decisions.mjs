import { acceptManagerDecision } from '../../src/decisionSubmission.js';

const WORLD_URL = process.env.TBG_WORLD_URL || 'https://raw.githubusercontent.com/davidmarsden/beautiful-game-engine/main/derived/world/world.json';
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const bearer = (request) => {
  const header = request.headers.get('authorization') || '';
  return header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
};
async function rest(path, token, options = {}) {
  const result = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}`, accept: 'application/json', ...(options.headers || {}) }
  });
  const body = await result.json().catch(() => ({}));
  if (!result.ok) throw new Error(body.message || `Supabase returned ${result.status}`);
  return body;
}

export default async (request) => {
  if (request.method !== 'POST') return response({ error: 'Method not allowed' }, 405);
  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return response({ error: 'Supabase is not configured' }, 503);
    const token = bearer(request);
    if (!token) return response({ error: 'Authentication required' }, 401);
    const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}` } });
    if (!userResponse.ok) return response({ error: 'Session is invalid or expired' }, 401);
    const user = await userResponse.json();
    const payload = await request.json();

    const profiles = await rest(`/rest/v1/manager_profiles?user_id=eq.${encodeURIComponent(user.id)}&select=id&limit=1`, token);
    const manager = profiles[0];
    if (!manager || manager.id !== payload.manager_id) return response({ error: 'Manager identity does not match this session' }, 403);

    const appointments = await rest(`/rest/v1/manager_appointments?manager_id=eq.${encodeURIComponent(manager.id)}&club_id=eq.${encodeURIComponent(payload.club_id)}&status=eq.active&select=id,world_id,club_id&limit=1`, token);
    if (!appointments[0]) return response({ error: 'You are not appointed to this club' }, 403);

    const fixtures = await rest(`/rest/v1/fixtures?id=eq.${encodeURIComponent(payload.fixture_id)}&select=id,home_club_id,away_club_id,submission_deadline_at,status&limit=1`, token);
    const fixture = fixtures[0];
    if (!fixture) return response({ error: 'Fixture not found' }, 404);
    if (![fixture.home_club_id, fixture.away_club_id].includes(payload.club_id)) return response({ error: 'Fixture does not involve your club' }, 403);
    if (fixture.submission_deadline_at && Date.now() >= new Date(fixture.submission_deadline_at).getTime()) return response({ error: 'The team-submission deadline has passed' }, 409);
    if (fixture.status !== 'scheduled') return response({ error: 'This fixture is not open for team submission' }, 409);

    const worldResponse = await fetch(WORLD_URL, { headers: { accept: 'application/json' } });
    if (!worldResponse.ok) throw new Error(`World source returned ${worldResponse.status}`);
    const world = await worldResponse.json();
    const accepted = acceptManagerDecision(payload, world);

    const existing = await rest(`/rest/v1/manager_submissions?fixture_id=eq.${encodeURIComponent(accepted.fixture_id)}&club_id=eq.${encodeURIComponent(accepted.club_id)}&select=id,version&limit=1`, token).catch(() => []);
    const row = {
      fixture_id: accepted.fixture_id,
      club_id: accepted.club_id,
      manager_id: accepted.manager_id,
      formation: accepted.formation,
      starting_xi: accepted.starting_xi,
      bench: accepted.bench,
      captain_id: accepted.captain_id,
      set_piece_takers: accepted.set_piece_takers,
      tactics: accepted.tactics,
      version: (existing[0]?.version || 0) + 1,
      status: 'submitted',
      submitted_at: accepted.submitted_at,
      updated_at: accepted.submitted_at
    };

    const saved = await rest('/rest/v1/manager_submissions?on_conflict=fixture_id,club_id', token, {
      method: 'POST',
      headers: { 'content-type': 'application/json', prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify(row)
    });

    await rest('/rest/v1/manager_messages', token, {
      method: 'POST',
      headers: { 'content-type': 'application/json', prefer: 'return=minimal' },
      body: JSON.stringify({
        recipient_manager_id: manager.id,
        club_id: accepted.club_id,
        message_type: 'submission_confirmation',
        subject: 'Team submission received',
        body: `Your team and tactics have been saved for fixture ${accepted.fixture_id}. Version ${row.version}.`,
        related_fixture_id: accepted.fixture_id,
        priority: 'normal'
      })
    }).catch(() => null);

    return response({ ...accepted, saved: true, submission: saved[0] || row, submitted_at: row.submitted_at, version: row.version }, existing[0] ? 200 : 201);
  } catch (error) {
    return response({ error: error.message, validation_errors: error.validationErrors || [] }, error.validationErrors ? 400 : 500);
  }
};