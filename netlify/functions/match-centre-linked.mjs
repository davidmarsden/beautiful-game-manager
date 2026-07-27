import matchCentre from './match-centre.mjs';
import { loadPersistentWorld } from '../../src/world/persistentSeasonLoop.js';
import { projectPinkFinalPlayerIdentity } from '../../src/world/pinkFinalPlayerProfile.js';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const PINK_FINAL_BASE_URL = process.env.PINK_FINAL_BASE_URL || undefined;

const text = (value) => String(value ?? '').trim();
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
});

async function canonicalWorld(worldId) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !worldId) return null;
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/canonical_world_saves?world_id=eq.${encodeURIComponent(worldId)}&select=save_envelope&limit=1`,
    {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        accept: 'application/json'
      }
    }
  );
  if (!response.ok) return null;
  const rows = await response.json().catch(() => []);
  return rows[0]?.save_envelope ? loadPersistentWorld(JSON.stringify(rows[0].save_envelope)) : null;
}

function identityFor(world, playerId, fallback = {}) {
  const id = text(playerId);
  if (!id) return { profile_url: null, pink_final_profile_status: 'unpublished' };
  const canonical = world?.squad_cycle?.players?.[id] || {};
  const projected = projectPinkFinalPlayerIdentity(
    { ...fallback, ...canonical, tbg_player_id: canonical.tbg_player_id || id },
    PINK_FINAL_BASE_URL ? { baseUrl: PINK_FINAL_BASE_URL } : {}
  );
  return {
    profile_url: projected.profile_url,
    pink_final_route_key: projected.pink_final_route_key,
    pink_final_profile_status: projected.pink_final_profile_status
  };
}

function decoratePlayer(world, row = {}, idField = 'player_id') {
  const playerId = text(row?.[idField] || row?.player_id || row?.id);
  return { ...row, ...identityFor(world, playerId, row) };
}

export function decorateMatchCentrePayload(payload = {}, world = null) {
  const events = (payload.events || []).map((event) => ({
    ...decoratePlayer(world, event),
    assist_profile_url: identityFor(world, event.assist_player_id).profile_url,
    player_on_profile_url: identityFor(world, event.player_on_id || event.in_player_id || event.replacement_player_id).profile_url,
    player_off_profile_url: identityFor(world, event.player_off_id || event.out_player_id || event.replaced_player_id).profile_url
  }));

  const decoratePerformance = (row) => decoratePlayer(world, row);
  const performances = {
    home: (payload.player_performances?.home || []).map(decoratePerformance),
    away: (payload.player_performances?.away || []).map(decoratePerformance)
  };
  const performanceById = new Map([...performances.home, ...performances.away].map((row) => [text(row.player_id), row]));

  const submissions = (payload.submissions || []).map((submission) => {
    const decorateLineupPlayer = (player) => {
      const identity = identityFor(world, player.id || player.player_id, player);
      const performance = player.performance ? { ...player.performance, ...identityFor(world, player.performance.player_id || player.id, player.performance) } : performanceById.get(text(player.id)) || null;
      return { ...player, ...identity, performance };
    };
    return {
      ...submission,
      starting_xi: (submission.starting_xi || []).map(decorateLineupPlayer),
      bench: (submission.bench || []).map(decorateLineupPlayer),
      captain_profile_url: identityFor(world, submission.captain_id).profile_url
    };
  });

  const decorateGoal = (row) => ({
    ...decoratePlayer(world, row),
    assist_profile_url: identityFor(world, row.assist_player_id).profile_url
  });
  const summary = payload.summary || {};
  const decoratedSummary = {
    ...summary,
    scorers: {
      home: (summary.scorers?.home || []).map(decorateGoal),
      away: (summary.scorers?.away || []).map(decorateGoal)
    },
    cards: {
      home: (summary.cards?.home || []).map((row) => decoratePlayer(world, row)),
      away: (summary.cards?.away || []).map((row) => decoratePlayer(world, row))
    },
    player_of_the_match: summary.player_of_the_match ? decoratePerformance(summary.player_of_the_match) : null,
    top_ratings: (summary.top_ratings || []).map(decoratePerformance)
  };

  return {
    ...payload,
    events,
    submissions,
    summary: decoratedSummary,
    player_performances: performances
  };
}

export default async (request) => {
  const response = await matchCentre(request);
  if (!response.ok) return response;
  const payload = await response.json().catch(() => null);
  if (!payload) return json({ error: 'Match Centre returned an invalid payload' }, 500);
  const world = await canonicalWorld(payload.fixture?.world_id);
  return json(decorateMatchCentrePayload(payload, world), response.status);
};
