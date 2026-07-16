import { buildEngineMatchContract } from '../../src/engineBridge.js';
import { simulateMatch } from '../../src/matchSimulation.js';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const WORLD_URL = process.env.TBG_WORLD_URL || 'https://raw.githubusercontent.com/davidmarsden/beautiful-game-engine/main/derived/world/world.json';
const ENGINE_RUNNER_URL = process.env.TBG_ENGINE_RUNNER_URL || '';
const ENGINE_RUNNER_TOKEN = process.env.TBG_ENGINE_RUNNER_TOKEN || '';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

async function rest(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, accept: 'application/json', ...(options.headers || {}) }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || body.error || `Supabase returned ${response.status}`);
  return body;
}

async function finishFixture(fixtureId, status, error = null) {
  await rest('/rest/v1/rpc/finish_fixture_engine_run', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fixture_key: fixtureId, run_status: status, failure_message: error })
  });
}

async function loadSubmissions(fixtureId) {
  return rest(`/rest/v1/manager_submissions?fixture_id=eq.${encodeURIComponent(fixtureId)}&status=eq.locked&select=*&order=club_id.asc`);
}

async function upsertPreparedRun(fixture, contract) {
  const existing = await rest(`/rest/v1/match_runs?fixture_id=eq.${encodeURIComponent(fixture.id)}&select=id,attempt_count&limit=1`);
  const row = {
    fixture_id: fixture.id,
    world_id: contract.fixture.world_id,
    engine_contract_version: contract.contract_version,
    status: 'prepared',
    request_payload: contract,
    attempt_count: Number(existing[0]?.attempt_count || 0),
    prepared_at: new Date().toISOString(), updated_at: new Date().toISOString(), last_error: null
  };
  const saved = await rest('/rest/v1/match_runs?on_conflict=fixture_id', {
    method: 'POST', headers: { 'content-type': 'application/json', prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify(row)
  });
  return saved[0] || row;
}

async function remoteResult(contract) {
  const response = await fetch(ENGINE_RUNNER_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', ...(ENGINE_RUNNER_TOKEN ? { authorization: `Bearer ${ENGINE_RUNNER_TOKEN}` } : {}) },
    body: JSON.stringify(contract)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || body.message || `Engine runner returned ${response.status}`);
  const result = body.result || body;
  if (result.status !== 'completed' || !result.score) throw new Error('Engine runner did not return a completed result');
  return result;
}

async function persistResult(fixture, run, result) {
  const now = new Date().toISOString();
  await rest(`/rest/v1/match_runs?fixture_id=eq.${encodeURIComponent(fixture.id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', prefer: 'return=minimal' },
    body: JSON.stringify({
      status: 'completed', engine_response: result, result_payload: result,
      attempt_count: Number(run.attempt_count || 0) + 1,
      submitted_at: now, completed_at: now, updated_at: now, last_error: null
    })
  });

  await rest(`/rest/v1/fixtures?id=eq.${encodeURIComponent(fixture.id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', prefer: 'return=minimal' },
    body: JSON.stringify({
      status: 'played', home_score: result.score.home, away_score: result.score.away,
      played_at: result.played_at || now, result_payload: result, engine_run_status: 'completed',
      engine_completed_at: now, engine_run_error: null
    })
  });

  if (Array.isArray(result.events) && result.events.length) {
    await rest('/rest/v1/match_events?on_conflict=event_id', {
      method: 'POST',
      headers: { 'content-type': 'application/json', prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify(result.events.map((event) => ({
        event_id: event.event_id, fixture_id: fixture.id, event_type: event.type,
        side: event.side, minute: event.minute, player_id: event.player_id || null,
        assist_player_id: event.assist_player_id || null, payload: event
      })))
    });
  }

  const managers = await rest(`/rest/v1/manager_appointments?world_id=eq.${encodeURIComponent(fixture.world_id)}&club_id=in.(${encodeURIComponent(fixture.home_club_id)},${encodeURIComponent(fixture.away_club_id)})&status=eq.active&select=manager_id,club_id`);
  for (const appointment of managers) {
    const own = appointment.club_id === fixture.home_club_id ? result.score.home : result.score.away;
    const opp = appointment.club_id === fixture.home_club_id ? result.score.away : result.score.home;
    await rest('/rest/v1/manager_messages', {
      method: 'POST', headers: { 'content-type': 'application/json', prefer: 'return=minimal' },
      body: JSON.stringify({
        recipient_manager_id: appointment.manager_id, club_id: appointment.club_id,
        related_fixture_id: fixture.id, message_type: 'match_result', priority: 'high',
        subject: `Full time: ${result.score.home}-${result.score.away}`,
        body: `Your fixture ${fixture.id} finished ${own}-${opp}. The full result and match events have been recorded.`
      })
    });
  }
}

async function markRunError(fixtureId, message) {
  const now = new Date().toISOString();
  await rest(`/rest/v1/match_runs?fixture_id=eq.${encodeURIComponent(fixtureId)}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json', prefer: 'return=minimal' }, body: JSON.stringify({ status: 'error', last_error: message, updated_at: now })
  }).catch(() => null);
  await finishFixture(fixtureId, 'error', message).catch(() => null);
}

export default async () => {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required' }, 503);
  try {
    const worldResponse = await fetch(WORLD_URL, { headers: { accept: 'application/json' } });
    if (!worldResponse.ok) throw new Error(`World source returned ${worldResponse.status}`);
    const world = await worldResponse.json();
    const fixtures = await rest('/rest/v1/rpc/claim_fixtures_for_engine', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ batch_size: 10 })
    });

    const processed = [];
    for (const fixture of fixtures) {
      try {
        const submissions = await loadSubmissions(fixture.id);
        const contract = buildEngineMatchContract({ fixture, submissions, world });
        const run = await upsertPreparedRun(fixture, contract);
        await finishFixture(fixture.id, 'prepared');
        const result = ENGINE_RUNNER_URL ? await remoteResult(contract) : simulateMatch(contract, world);
        await persistResult(fixture, run, result);
        processed.push({ fixture_id: fixture.id, contract_version: contract.contract_version, result_version: result.result_version, score: result.score, mode: ENGINE_RUNNER_URL ? 'remote_engine' : 'built_in_simulator' });
      } catch (error) {
        await markRunError(fixture.id, error.message);
        processed.push({ fixture_id: fixture.id, error: error.message });
      }
    }
    return json({ claimed: fixtures.length, engine_configured: Boolean(ENGINE_RUNNER_URL), processed });
  } catch (error) {
    return json({ error: error.message }, 500);
  }
};
