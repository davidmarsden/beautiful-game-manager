import { acceptManagerDecision } from "../../src/decisionSubmission.js";

const WORLD_URL = process.env.TBG_WORLD_URL || "https://raw.githubusercontent.com/davidmarsden/beautiful-game-engine/main/derived/world/world.json";
const SUPABASE_URL = process.env.SUPABASE_URL || "https://edarvglbzuefveqcjpdt.supabase.co";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";

const response = (body, status) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const bearer = (request) => {
  const header = request.headers.get("authorization") || "";
  return header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
};

async function rest(path, token) {
  const result = await fetch(`${SUPABASE_URL}${path}`, { headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}`, accept: "application/json" } });
  if (!result.ok) throw new Error(`Supabase returned ${result.status}`);
  return result.json();
}

export default async (request) => {
  if (request.method !== "POST") return response({ error: "Method not allowed" }, 405);
  try {
    if (!SUPABASE_ANON_KEY) return response({ error: "SUPABASE_ANON_KEY is not configured" }, 503);
    const token = bearer(request);
    if (!token) return response({ error: "Authentication required" }, 401);

    const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}` } });
    if (!userResponse.ok) return response({ error: "Session is invalid or expired" }, 401);
    const user = await userResponse.json();
    const payload = await request.json();

    const profiles = await rest(`/rest/v1/manager_profiles?user_id=eq.${encodeURIComponent(user.id)}&select=id&limit=1`, token);
    const manager = profiles[0];
    if (!manager || manager.id !== payload.manager_id) return response({ error: "Manager identity does not match this session" }, 403);

    const appointments = await rest(`/rest/v1/manager_appointments?manager_id=eq.${encodeURIComponent(manager.id)}&club_id=eq.${encodeURIComponent(payload.club_id)}&status=eq.active&select=id,world_id,club_id&limit=1`, token);
    if (!appointments[0]) return response({ error: "You are not appointed to this club" }, 403);

    const fixtures = await rest(`/rest/v1/fixtures?id=eq.${encodeURIComponent(payload.fixture_id)}&select=id,home_club_id,away_club_id,submission_deadline_at,status&limit=1`, token).catch(() => []);
    const fixture = fixtures[0];
    if (fixture) {
      if (![fixture.home_club_id, fixture.away_club_id].includes(payload.club_id)) return response({ error: "Fixture does not involve your club" }, 403);
      if (fixture.submission_deadline_at && Date.now() >= new Date(fixture.submission_deadline_at).getTime()) return response({ error: "The team-submission deadline has passed" }, 409);
      if (fixture.status !== "scheduled") return response({ error: "This fixture is not open for team submission" }, 409);
    }

    const worldResponse = await fetch(WORLD_URL, { headers: { accept: "application/json" } });
    if (!worldResponse.ok) throw new Error(`World source returned ${worldResponse.status}`);
    const world = await worldResponse.json();
    const accepted = acceptManagerDecision(payload, world);
    return response({ ...accepted, authenticated_manager_id: manager.id, persistence: "preview_only_until_manager_submissions_table" }, 201);
  } catch (error) {
    return response({ error: error.message, validation_errors: error.validationErrors || [] }, error.validationErrors ? 400 : 500);
  }
};
