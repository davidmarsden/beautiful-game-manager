import { buildEngineMatchContract } from '../../src/engineBridge.js';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const WORLD_URL = process.env.TBG_WORLD_URL || 'https://raw.githubusercontent.com/davidmarsden/beautiful-game-engine/main/derived/world/world.json';
const ENGINE_RUNNER_URL = process.env.TBG_ENGINE_RUNNER_URL || '';
const ENGINE_RUNNER_TOKEN = process.env.TBG_ENGINE_RUNNER_TOKEN || '';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
});

async function rest(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      accept: 'application/json',
      ...(options.headers || {})
    }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || body.error || `Supabase returned ${response.status}`);
  return body;
}

async function finishFixture(fixtureId, status, error = null) {
  await rest('/rest/v1/rpc/finish_fixture_engine_run', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fixture_key: fixtureId, run_status: status, failure_message: error })
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
    prepared_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    last_error: null
  };
  const saved = await rest('/rest/v1/match_runs?on_conflict=fixture_id', {
    method: 'POST',
    headers: { 'content-type': 'application/json', prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(row)
  });
  return saved[0] || row;
}

async function submitToEngine(run, contract) {
  if (!ENGINE_RUNNER_URL) return { mode: 'prepared_only', run };

  const response = await fetch(ENGINE_RUNNER_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      ...(ENGINE_RUNNER_TOKEN ? { authorization: `Bearer ${ENGINE_RUNNER_TOKEN}` } : {})
    },
    body: JSON.stringify(contract)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || body.message || `Engine runner returned ${response.status}`);

  const completed = body.status === 'completed' || Boolean(body.result);
  const status = completed ? 'completed' : 'submitted';
  const now = new Date().toISOString();
  const updated = await rest(`/rest/v1/match_runs?fixture_id=eq.${encodeURIComponent(contract.fixture.fixture_id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', prefer: 'return=representation' },
    body: JSON.stringify({
      status,
      engine_response: body,
      attempt_count: Number(run.attempt_count || 0) + 1,
      submitted_at: now,
      completed_at: completed ? now : null,
      updated_at: now,
      last_error: null
    })
  });
  return { mode: 'remote_engine', status, run: updated[0], engine_response: body };
}

async function markRunError(fixtureId, message) {
  const now = new Date().toISOString();
  await rest(`/rest/v1/match_runs?fixture_id=eq.${encodeURIComponent(fixtureId)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', prefer: 'return=minimal' },
    body: JSON.stringify({ status: 'error', last_error: message, updated_at: now })
  }).catch(() => null);
  await finishFixture(fixtureId, 'error', message).catch(() => null);
}

export default async () => {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: 'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required' }, 503);
  }

  try {
    const worldResponse = await fetch(WORLD_URL, { headers: { accept: 'application/json' } });
    if (!worldResponse.ok) throw new Error(`World source returned ${worldResponse.status}`);
    const world = await worldResponse.json();

    const fixtures = await rest('/rest/v1/rpc/claim_fixtures_for_engine', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ batch_size: 10 })
    });

    const processed = [];
    for (const fixture of fixtures) {
      try {
        const submissions = await loadSubmissions(fixture.id);
        const contract = buildEngineMatchContract({ fixture, submissions, world });
        const run = await upsertPreparedRun(fixture, contract);
        await finishFixture(fixture.id, 'prepared');
        const bridge = await submitToEngine(run, contract);
        if (bridge.mode === 'remote_engine') await finishFixture(fixture.id, bridge.status);
        processed.push({ fixture_id: fixture.id, contract_version: contract.contract_version, ...bridge });
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
