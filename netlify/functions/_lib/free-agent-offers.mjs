import { createHash } from 'node:crypto';
import { loadPersistentWorld } from '../../../src/world/persistentSeasonLoop.js';
import { signFreeAgent } from './free-agent-settlement.mjs';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const isJwt = (value) => String(value || '').split('.').length === 3;

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

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const ratingOf = (player) => Number(player?.underlying_ability_rating ?? player?.tbg_rating ?? player?.rating ?? 0) || 0;
const positionOf = (player) => String(player?.position_group || player?.position || player?.primary_position || '').toLowerCase();

export function freeAgentOfferExpectation(player) {
  const marketValue = Math.max(0, Number(player?.market_value_eur) || 0);
  const rating = ratingOf(player);
  const valueWage = Math.round(marketValue / 500);
  const ratingFloor = rating >= 90 ? 45000 : rating >= 85 ? 20000 : rating >= 80 ? 8000 : rating >= 70 ? 2500 : 1000;
  return Math.max(1000, valueWage, ratingFloor);
}

export function scoreFreeAgentOffer({ world, offer }) {
  const player = offer.player_snapshot || {};
  const expectedWage = freeAgentOfferExpectation(player);
  const wage = Math.max(0, Number(offer.wage) || 0);
  const years = clamp(Number(offer.contract_years) || 3, 1, 5);
  const allPlayers = Object.values(world?.squad_cycle?.players || {});
  const clubPlayers = allPlayers.filter((row) => String(row?.club_id || '') === String(offer.club_id || ''));
  const averageClubRating = clubPlayers.length
    ? clubPlayers.reduce((sum, row) => sum + ratingOf(row), 0) / clubPlayers.length
    : 75;
  const samePosition = clubPlayers.filter((row) => positionOf(row) && positionOf(row) === positionOf(player));
  const comparison = samePosition.length
    ? samePosition.reduce((sum, row) => sum + ratingOf(row), 0) / samePosition.length
    : averageClubRating;
  const playerRating = ratingOf(player);

  const wageScore = clamp((wage / expectedWage) * 65, 0, 90);
  const securityScore = years * 4;
  const clubAttractiveness = clamp(((averageClubRating - 72) / 20) * 15, 0, 15);
  const opportunityScore = clamp(8 + (playerRating - comparison) * 0.8, 0, 15);
  const score = Number((wageScore + securityScore + clubAttractiveness + opportunityScore).toFixed(2));

  return {
    score,
    minimumScore: 70,
    expectedWage,
    components: {
      wage: Number(wageScore.toFixed(2)),
      security: Number(securityScore.toFixed(2)),
      club_attractiveness: Number(clubAttractiveness.toFixed(2)),
      opportunity: Number(opportunityScore.toFixed(2))
    }
  };
}

function requestKey({ userId, worldId, playerId, contractYears, wage, clientRequestId }) {
  return createHash('sha256').update(JSON.stringify({
    user_id: userId,
    world_id: worldId,
    action: 'offer_free_agent_contract',
    player_id: playerId,
    contract_years: contractYears,
    wage,
    client_request_id: clientRequestId
  })).digest('hex');
}

export async function submitFreeAgentOffer({ userId, worldId, player, contractYears, wage, clientRequestId }) {
  const playerId = String(player?.tbg_player_id || '').trim();
  const safeYears = clamp(Number(contractYears) || 3, 1, 5);
  const safeWage = Math.max(0, Math.round(Number(wage) || 0));
  const key = requestKey({ userId, worldId, playerId, contractYears: safeYears, wage: safeWage, clientRequestId });
  return service('/rest/v1/rpc/submit_free_agent_offer_for_user', {
    method: 'POST',
    body: JSON.stringify({
      p_user_id: userId,
      p_world_id: worldId,
      p_player_id: playerId,
      p_transfermarkt_id: String(player.transfermarkt_id || '').trim() || null,
      p_player_name: String(player.display_name || player.full_name || playerId),
      p_player_snapshot: player,
      p_contract_years: safeYears,
      p_wage: safeWage,
      p_request_key: key
    })
  });
}

async function patchOffer(id, values) {
  return service(`/rest/v1/free_agent_offers?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ ...values, updated_at: new Date().toISOString() })
  });
}

async function canonicalWorld(worldId) {
  const rows = await service(`/rest/v1/canonical_world_saves?world_id=eq.${encodeURIComponent(worldId)}&select=save_envelope,turn_status&limit=1`);
  if (!rows[0] || rows[0].turn_status !== 'open') return null;
  return loadPersistentWorld(JSON.stringify(rows[0].save_envelope));
}

function decisionReason(evaluation, winner = false) {
  if (winner) return `player_accepted_best_offer; expected_wage=${evaluation.expectedWage}; score=${evaluation.score}`;
  if (evaluation.score < evaluation.minimumScore) return `terms_below_expectation; expected_wage=${evaluation.expectedWage}; score=${evaluation.score}`;
  return `player_chose_other_club; score=${evaluation.score}`;
}

export async function resolveDueFreeAgentOffers({ worldId, limit = 5 } = {}) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !worldId) return [];
  const due = await service(`/rest/v1/free_agent_offers?world_id=eq.${encodeURIComponent(worldId)}&status=eq.pending&decision_at=lte.${encodeURIComponent(new Date().toISOString())}&select=*&order=decision_at.asc,created_at.asc&limit=${Math.max(1, Math.min(100, Number(limit) * 20))}`);
  if (!Array.isArray(due) || !due.length) return [];
  const playerIds = [...new Set(due.map((row) => row.player_id))].slice(0, Math.max(1, Number(limit) || 5));
  const outcomes = [];

  for (const playerId of playerIds) {
    const offers = await service(`/rest/v1/free_agent_offers?world_id=eq.${encodeURIComponent(worldId)}&player_id=eq.${encodeURIComponent(playerId)}&status=eq.pending&select=*&order=created_at.asc`);
    if (!offers.length) continue;
    const world = await canonicalWorld(worldId);
    if (!world) break;

    const ranked = offers.map((offer) => ({ offer, evaluation: scoreFreeAgentOffer({ world, offer }) }))
      .sort((a, b) => b.evaluation.score - a.evaluation.score
        || Number(b.offer.wage) - Number(a.offer.wage)
        || Number(b.offer.contract_years) - Number(a.offer.contract_years)
        || String(a.offer.created_at).localeCompare(String(b.offer.created_at))
        || String(a.offer.id).localeCompare(String(b.offer.id)));

    const qualifying = ranked.filter((row) => row.evaluation.score >= row.evaluation.minimumScore);
    if (!qualifying.length) {
      for (const row of ranked) {
        await patchOffer(row.offer.id, {
          status: 'rejected',
          offer_score: row.evaluation.score,
          minimum_score: row.evaluation.minimumScore,
          decision_reason: decisionReason(row.evaluation),
          terminal_at: new Date().toISOString()
        });
      }
      outcomes.push({ player_id: playerId, status: 'rejected_all' });
      continue;
    }

    let winner = null;
    for (const row of qualifying) {
      const result = await signFreeAgent({
        userId: row.offer.manager_id,
        worldId,
        player: row.offer.player_snapshot,
        contractYears: row.offer.contract_years,
        wage: row.offer.wage,
        clientRequestId: `free-agent-offer:${row.offer.id}`
      }).catch((error) => ({ accepted: false, transient_error: error.message }));

      if (result?.accepted) {
        winner = { ...row, result };
        break;
      }
      if (result?.status === 'application_failed' || result?.reason === 'player_already_acquired') {
        await patchOffer(row.offer.id, {
          status: 'application_failed',
          offer_score: row.evaluation.score,
          minimum_score: row.evaluation.minimumScore,
          decision_reason: result.reason || 'canonical_application_failed',
          acquisition_id: result.acquisition_id || null,
          terminal_at: new Date().toISOString()
        });
        continue;
      }
      winner = null;
      break;
    }

    if (!winner) continue;
    await patchOffer(winner.offer.id, {
      status: 'accepted',
      offer_score: winner.evaluation.score,
      minimum_score: winner.evaluation.minimumScore,
      decision_reason: decisionReason(winner.evaluation, true),
      acquisition_id: winner.result.acquisition_id || null,
      terminal_at: new Date().toISOString()
    });
    for (const row of ranked) {
      if (row.offer.id === winner.offer.id || row.offer.status !== 'pending') continue;
      await patchOffer(row.offer.id, {
        status: 'rejected',
        offer_score: row.evaluation.score,
        minimum_score: row.evaluation.minimumScore,
        decision_reason: decisionReason(row.evaluation),
        terminal_at: new Date().toISOString()
      });
    }
    outcomes.push({ player_id: playerId, status: 'accepted', club_id: winner.offer.club_id, offer_id: winner.offer.id });
  }

  return outcomes;
}
