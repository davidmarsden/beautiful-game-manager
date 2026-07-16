const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const WORLD_URL = process.env.TBG_WORLD_URL || 'https://raw.githubusercontent.com/davidmarsden/beautiful-game-engine/main/derived/world/world.json';

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

const text = (value) => String(value ?? '').trim();
const rating = (player) => Number(
  player.underlying_ability_rating ??
  player.tbg_rating ??
  player.rating ??
  player.overall_rating ??
  0
);
const position = (player) => text(
  player.position || player.primary_position || player.position_name ||
  player.position_detail || player.transfermarkt_position || player.canonical_position ||
  player.position_group
);
const playerId = (player) => text(player.tbg_player_id || player.transfermarkt_id || player.id);
const isGoalkeeper = (player) => position(player).toLowerCase().includes('goalkeeper');

function loanedOut(player, ownership = {}) {
  const loan = ownership.loan || player.loan || {};
  const status = text(loan.status || ownership.loan_status || player.loan_status).toLowerCase();
  return Boolean(
    player.loaned_out || ownership.loaned_out ||
    status === 'loaned_out' || status === 'out' ||
    text(loan.club_id || ownership.loan_club_id || player.loan_club_id) ||
    text(loan.club_name || ownership.loan_club_name || player.loan_club_name)
  );
}

const unavailable = (player, ownership) => {
  const status = text(player.condition?.injury_status || player.injury_status).toLowerCase();
  return Boolean(loanedOut(player, ownership) || ['injured','suspended','unavailable'].includes(status));
};

function buildFallback(club, world) {
  const playersById = new Map((world.players || []).map((player) => [playerId(player), player]));
  const ownershipById = new Map((world.player_ownership || []).map((row) => [text(row.tbg_player_id), row]));
  const squad = (club.squad?.player_ids || [])
    .map((id) => playersById.get(text(id)))
    .filter(Boolean)
    .filter((player) => !unavailable(player, ownershipById.get(playerId(player))));

  const sorted = [...squad].sort((a, b) => rating(b) - rating(a) || playerId(a).localeCompare(playerId(b)));
  const goalkeeper = sorted.find(isGoalkeeper);
  if (!goalkeeper) throw new Error(`AI fallback could not find an available goalkeeper for ${club.tbg_club_id}`);

  const outfield = sorted.filter((player) => playerId(player) !== playerId(goalkeeper));
  if (outfield.length < 10) throw new Error(`AI fallback could not find ten available outfield players for ${club.tbg_club_id}`);

  const starting = [goalkeeper, ...outfield.slice(0, 10)].map(playerId);
  const bench = outfield.slice(10, 17).map(playerId);
  return {
    formation: '4-3-3-wide',
    starting_xi: starting,
    bench,
    captain_id: starting.slice(1).sort((a, b) => rating(playersById.get(b)) - rating(playersById.get(a)))[0] || starting[0],
    set_piece_takers: {},
    tactics: {
      mentality: 'balanced',
      pressing: 'mid',
      tempo: 'normal',
      width: 'balanced',
      defensive_line: 'standard'
    }
  };
}

async function activeManager(worldId, clubId) {
  const rows = await rest(`/rest/v1/manager_appointments?world_id=eq.${encodeURIComponent(worldId)}&club_id=eq.${encodeURIComponent(clubId)}&status=eq.active&select=manager_id&limit=1`);
  return rows[0]?.manager_id || null;
}

async function existingSubmission(fixtureId, clubId) {
  const rows = await rest(`/rest/v1/manager_submissions?fixture_id=eq.${encodeURIComponent(fixtureId)}&club_id=eq.${encodeURIComponent(clubId)}&select=*&limit=1`);
  return rows[0] || null;
}

async function lockManagerSubmission(submission) {
  const now = new Date().toISOString();
  const rows = await rest(`/rest/v1/manager_submissions?id=eq.${encodeURIComponent(submission.id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', prefer: 'return=representation' },
    body: JSON.stringify({ status: 'locked', locked_at: submission.locked_at || now, updated_at: now, lock_reason: 'deadline' })
  });
  return rows[0];
}

async function createFallbackSubmission({ fixture, clubId, managerId, fallback }) {
  const now = new Date().toISOString();
  const rows = await rest('/rest/v1/manager_submissions?on_conflict=fixture_id,club_id', {
    method: 'POST',
    headers: { 'content-type': 'application/json', prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({
      fixture_id: fixture.id,
      club_id: clubId,
      manager_id: managerId,
      ...fallback,
      version: 1,
      status: 'locked',
      submission_source: 'ai_fallback',
      lock_reason: 'missed_deadline',
      submitted_at: now,
      updated_at: now,
      locked_at: now
    })
  });
  return rows[0];
}

async function sendMessage(managerId, clubId, fixtureId, subject, body, priority = 'normal') {
  if (!managerId) return;
  await rest('/rest/v1/manager_messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', prefer: 'return=minimal' },
    body: JSON.stringify({
      recipient_manager_id: managerId,
      club_id: clubId,
      related_fixture_id: fixtureId,
      message_type: subject === 'Team locked' ? 'fixture_locked' : 'missed_deadline',
      subject,
      body,
      priority
    })
  });
}

async function completeFixture(fixtureId, error = null) {
  await rest('/rest/v1/rpc/complete_fixture_submission_lock', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fixture_key: fixtureId, failure_message: error })
  });
}

async function processFixture(fixture, world, clubsById) {
  const clubIds = [fixture.home_club_id, fixture.away_club_id];
  const outcomes = [];

  for (const clubId of clubIds) {
    const managerId = await activeManager(fixture.world_id, clubId);
    const existing = await existingSubmission(fixture.id, clubId);

    if (existing) {
      await lockManagerSubmission(existing);
      await sendMessage(managerId, clubId, fixture.id, 'Team locked', `Your latest submitted team for fixture ${fixture.id} has been locked at the deadline.`);
      outcomes.push({ club_id: clubId, source: existing.submission_source || 'manager' });
      continue;
    }

    const club = clubsById.get(clubId);
    if (!club) throw new Error(`Club ${clubId} is missing from the current world build`);
    if (!managerId) throw new Error(`Club ${clubId} has no active manager appointment for AI fallback ownership`);

    const fallback = buildFallback(club, world);
    await createFallbackSubmission({ fixture, clubId, managerId, fallback });
    await sendMessage(managerId, clubId, fixture.id, 'Deadline missed — AI team selected', `No valid team was submitted before the deadline for fixture ${fixture.id}. The assistant manager selected and locked a balanced 4-3-3 team.`, 'high');
    outcomes.push({ club_id: clubId, source: 'ai_fallback' });
  }

  await completeFixture(fixture.id);
  return outcomes;
}

export default async () => {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: 'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required' }, 503);
  }

  try {
    const worldResponse = await fetch(WORLD_URL, { headers: { accept: 'application/json' } });
    if (!worldResponse.ok) throw new Error(`World source returned ${worldResponse.status}`);
    const world = await worldResponse.json();
    const clubsById = new Map((world.clubs || []).map((club) => [club.tbg_club_id, club]));

    const fixtures = await rest('/rest/v1/rpc/claim_expired_fixtures_for_submission_lock', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ batch_size: 20 })
    });

    const processed = [];
    for (const fixture of fixtures) {
      try {
        processed.push({ fixture_id: fixture.id, outcomes: await processFixture(fixture, world, clubsById) });
      } catch (error) {
        await completeFixture(fixture.id, error.message).catch(() => null);
        processed.push({ fixture_id: fixture.id, error: error.message });
      }
    }

    return json({ claimed: fixtures.length, processed });
  } catch (error) {
    return json({ error: error.message }, 500);
  }
};