import { createHash, randomUUID } from 'node:crypto';
import { settleDueTransfers } from './_lib/transfer-settlement.mjs';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
});

const bearerToken = (request) => {
  const header = request.headers.get('authorization') || '';
  return header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
};
const isJwt = (value) => String(value || '').split('.').length === 3;

async function requestSupabase(path, { apiKey, bearer, ...options } = {}) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: {
      apikey: apiKey,
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
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

const userSupabase = (path, token, options = {}) => requestSupabase(path, {
  ...options,
  apiKey: SUPABASE_ANON_KEY,
  bearer: token
});
const serverSupabase = (path, options = {}) => requestSupabase(path, {
  ...options,
  apiKey: SUPABASE_SERVICE_ROLE_KEY,
  ...(isJwt(SUPABASE_SERVICE_ROLE_KEY) ? { bearer: SUPABASE_SERVICE_ROLE_KEY } : {})
});

async function identity(token) {
  const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}` }
  });
  if (!userResponse.ok) throw new Error('Session is invalid or expired');
  const user = await userResponse.json();
  const profiles = await userSupabase(`/rest/v1/manager_profiles?user_id=eq.${encodeURIComponent(user.id)}&select=id&limit=1`, token);
  const manager = profiles[0];
  if (!manager) throw new Error('Manager profile has not been created yet');
  const appointments = await userSupabase(`/rest/v1/manager_appointments?manager_id=eq.${encodeURIComponent(manager.id)}&status=eq.active&select=world_id,club_id&limit=1`, token);
  const appointment = appointments[0];
  if (!appointment) throw new Error('No active club appointment');
  return { user, manager, appointment };
}

function requestKey(payload) {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function attachPendingChanges(market, changes) {
  const byDeal = new Map((Array.isArray(changes) ? changes : []).map((change) => [change.deal_id, change]));
  const decorate = (offers) => (Array.isArray(offers) ? offers : []).map((offer) => ({ ...offer, pending_change: byDeal.get(offer.deal_id) || null }));
  return {
    ...market,
    incoming_offers: decorate(market?.incoming_offers),
    outgoing_offers: decorate(market?.outgoing_offers)
  };
}

function attachLifecycle(market, lifecycle) {
  const byDeal = new Map((Array.isArray(lifecycle) ? lifecycle : []).map((row) => [row.deal_id, row]));
  const decorate = (offers) => (Array.isArray(offers) ? offers : []).map((offer) => ({ ...offer, lifecycle: byDeal.get(offer.deal_id) || null }));
  return {
    ...market,
    incoming_offers: decorate(market?.incoming_offers),
    outgoing_offers: decorate(market?.outgoing_offers)
  };
}

function attachExchangeLegs(market, exchangeRows) {
  const byDeal = new Map((Array.isArray(exchangeRows) ? exchangeRows : []).map((row) => [row.deal_id, row]));
  const decorate = (offers) => (Array.isArray(offers) ? offers : []).map((offer) => {
    const exchange = byDeal.get(offer.deal_id);
    return exchange ? { ...offer, legs: exchange.legs || [], revision_no: exchange.revision_no || offer.revision_no } : offer;
  });
  return {
    ...market,
    incoming_offers: decorate(market?.incoming_offers),
    outgoing_offers: decorate(market?.outgoing_offers)
  };
}

function normalizeExchangeLegs(rawLegs, { ownClubId, counterpartClubId }) {
  const pair = new Set([ownClubId, counterpartClubId]);
  if (!Array.isArray(rawLegs) || !rawLegs.length) throw new Error('Exchange legs are required');
  const seenPlayers = new Set();
  const normalized = rawLegs.map((raw) => {
    const legType = String(raw?.leg_type || raw?.legType || '').trim().toLowerCase();
    const fromClubId = String(raw?.from_club_id || raw?.fromClubId || '').trim();
    const toClubId = String(raw?.to_club_id || raw?.toClubId || '').trim();
    if (!['permanent_transfer', 'cash'].includes(legType)) throw new Error('Exchange offers support permanent player and cash legs only');
    if (!pair.has(fromClubId) || !pair.has(toClubId) || fromClubId === toClubId) throw new Error('Every exchange leg must move between the two participating clubs');
    if (legType === 'cash') {
      const amount = Math.max(0, Number(raw?.amount ?? 0) || 0);
      if (!(amount > 0)) throw new Error('Cash legs must be greater than zero');
      return { leg_type: 'cash', from_club_id: fromClubId, to_club_id: toClubId, amount };
    }
    const playerId = String(raw?.player_id || raw?.playerId || '').trim();
    if (!playerId) throw new Error('Every player leg requires a player');
    if (seenPlayers.has(playerId)) throw new Error('The same player cannot appear twice in one exchange');
    seenPlayers.add(playerId);
    const contractYears = Math.max(1, Math.min(5, Number(raw?.contract_years ?? raw?.contractYears ?? 3) || 3));
    return {
      leg_type: 'permanent_transfer',
      from_club_id: fromClubId,
      to_club_id: toClubId,
      player_id: playerId,
      contract_years: contractYears
    };
  });
  if (!normalized.some((leg) => leg.leg_type === 'permanent_transfer')) throw new Error('An exchange offer must include at least one player');
  return normalized;
}

async function currentDealLegs(current, dealId) {
  const rows = await serverSupabase('/rest/v1/rpc/get_manager_transfer_exchange_legs_for_user', {
    method: 'POST',
    body: JSON.stringify({ p_user_id: current.user.id, p_world_id: current.appointment.world_id })
  }).catch(() => []);
  return (Array.isArray(rows) ? rows : []).find((row) => row.deal_id === dealId)?.legs || [];
}

function isComplexExchange(legs, ownClubId) {
  const players = (Array.isArray(legs) ? legs : []).filter((leg) => leg.leg_type === 'permanent_transfer');
  return players.length > 1 || players.some((leg) => leg.from_club_id === ownClubId);
}

export default async (request) => {
  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'Supabase is not configured' }, 503);
    const token = bearerToken(request);
    if (!token) return json({ error: 'Authentication required' }, 401);
    const current = await identity(token);

    if (request.method === 'GET') {
      await settleDueTransfers({ worldId: current.appointment.world_id, limit: 5 }).catch(() => null);
      const [market, legacyOutgoing, agreedChanges, lifecycle, exchangeRows] = await Promise.all([
        serverSupabase('/rest/v1/rpc/get_manager_transfer_market_for_user', {
          method: 'POST',
          body: JSON.stringify({ p_user_id: current.user.id, p_world_id: current.appointment.world_id })
        }),
        serverSupabase('/rest/v1/rpc/get_manager_legacy_outgoing_transfer_offers_for_user', {
          method: 'POST',
          body: JSON.stringify({ p_user_id: current.user.id, p_world_id: current.appointment.world_id })
        }),
        serverSupabase('/rest/v1/rpc/get_manager_transfer_agreed_changes_for_user', {
          method: 'POST',
          body: JSON.stringify({ p_user_id: current.user.id, p_world_id: current.appointment.world_id })
        }).catch(() => []),
        serverSupabase('/rest/v1/rpc/get_manager_transfer_lifecycle_for_user', {
          method: 'POST',
          body: JSON.stringify({ p_user_id: current.user.id, p_world_id: current.appointment.world_id })
        }).catch(() => []),
        serverSupabase('/rest/v1/rpc/get_manager_transfer_exchange_legs_for_user', {
          method: 'POST',
          body: JSON.stringify({ p_user_id: current.user.id, p_world_id: current.appointment.world_id })
        }).catch(() => [])
      ]);
      const decoratedMarket = attachExchangeLegs(attachLifecycle(attachPendingChanges(market || {
        world_id: current.appointment.world_id,
        club_id: current.appointment.club_id,
        listings: [],
        outgoing_offers: [],
        incoming_offers: []
      }, agreedChanges), lifecycle), exchangeRows);
      return json({
        ...decoratedMarket,
        legacy_outgoing_offers: Array.isArray(legacyOutgoing) ? legacyOutgoing : []
      });
    }

    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

    const body = await request.json().catch(() => ({}));
    const action = String(body.action || '').trim().toLowerCase();
    const clientRequestId = String(body.client_request_id || body.clientRequestId || '').trim() || randomUUID();

    if (action === 'withdraw_legacy_offer') {
      const proposalId = String(body.proposal_id || body.proposalId || '').trim();
      if (!proposalId) return json({ error: 'Transfer offer is required' }, 400);
      const result = await serverSupabase('/rest/v1/rpc/withdraw_manager_legacy_transfer_offer_for_user', {
        method: 'POST',
        body: JSON.stringify({
          p_user_id: current.user.id,
          p_world_id: current.appointment.world_id,
          p_proposal_id: proposalId
        })
      });
      return json({ accepted: true, action, offer: result, message: 'Legacy transfer offer withdrawn immediately.' });
    }

    if (action === 'cancel_in_grace') {
      const dealId = String(body.deal_id || body.dealId || '').trim();
      if (!dealId) return json({ error: 'Deal is required' }, 400);
      const key = requestKey({
        user_id: current.user.id,
        world_id: current.appointment.world_id,
        action,
        deal_id: dealId,
        client_request_id: clientRequestId
      });
      const result = await serverSupabase('/rest/v1/rpc/cancel_manager_transfer_deal_in_grace_for_user', {
        method: 'POST',
        body: JSON.stringify({
          p_user_id: current.user.id,
          p_world_id: current.appointment.world_id,
          p_deal_id: dealId,
          p_request_key: key
        })
      });
      return json({ accepted: true, action, deal: result, message: 'Transfer cancelled during the mistake-grace period.' });
    }

    if (['propose_agreed_amendment', 'propose_agreed_cancellation'].includes(action)) {
      const dealId = String(body.deal_id || body.dealId || '').trim();
      const revisionNo = Number(body.revision_no ?? body.revisionNo);
      if (!dealId) return json({ error: 'Deal is required' }, 400);
      if (!Number.isInteger(revisionNo) || revisionNo < 1) return json({ error: 'Exact agreed revision is required' }, 400);
      const changeType = action === 'propose_agreed_amendment' ? 'amendment' : 'cancellation';
      const fee = Math.max(0, Number(body.fee ?? 0) || 0);
      const contractYears = Math.max(1, Math.min(5, Number(body.contract_years ?? body.contractYears ?? 3) || 3));
      const key = requestKey({
        user_id: current.user.id,
        world_id: current.appointment.world_id,
        action,
        deal_id: dealId,
        revision_no: revisionNo,
        fee: changeType === 'amendment' ? fee : null,
        contract_years: changeType === 'amendment' ? contractYears : null,
        client_request_id: clientRequestId
      });
      const result = await serverSupabase('/rest/v1/rpc/propose_manager_transfer_agreed_change_for_user', {
        method: 'POST',
        body: JSON.stringify({
          p_user_id: current.user.id,
          p_world_id: current.appointment.world_id,
          p_deal_id: dealId,
          p_revision_no: revisionNo,
          p_change_type: changeType,
          p_fee: changeType === 'amendment' ? fee : null,
          p_contract_years: changeType === 'amendment' ? contractYears : null,
          p_request_key: key
        })
      });
      return json({
        accepted: true,
        action,
        change: result,
        message: changeType === 'amendment'
          ? 'Amendment proposed. The existing agreed terms remain in force unless the other club accepts the change.'
          : 'Mutual cancellation proposed. The existing agreed deal remains in force unless the other club accepts cancellation.'
      });
    }

    if (['accept_agreed_change', 'reject_agreed_change'].includes(action)) {
      const changeRequestId = String(body.change_request_id || body.changeRequestId || '').trim();
      if (!changeRequestId) return json({ error: 'Change request is required' }, 400);
      const responseAction = action === 'accept_agreed_change' ? 'accept' : 'reject';
      const key = requestKey({
        user_id: current.user.id,
        world_id: current.appointment.world_id,
        action,
        change_request_id: changeRequestId,
        client_request_id: clientRequestId
      });
      const result = await serverSupabase('/rest/v1/rpc/respond_manager_transfer_agreed_change_for_user', {
        method: 'POST',
        body: JSON.stringify({
          p_user_id: current.user.id,
          p_world_id: current.appointment.world_id,
          p_change_request_id: changeRequestId,
          p_action: responseAction,
          p_request_key: key
        })
      });
      const message = responseAction === 'reject'
        ? 'Proposed change rejected. The existing agreed terms remain in force.'
        : result?.deal_status === 'mutually_cancelled'
          ? 'Both clubs agreed to cancel the transfer.'
          : 'Both clubs agreed the amendment. The new immutable revision is now the agreed deal.';
      return json({ accepted: true, action, change: result, message });
    }

    if (['accept_offer', 'decline_offer', 'counter_offer'].includes(action)) {
      const dealId = String(body.deal_id || body.dealId || '').trim();
      const revisionNo = Number(body.revision_no ?? body.revisionNo);
      if (!dealId) return json({ error: 'Deal is required' }, 400);
      if (!Number.isInteger(revisionNo) || revisionNo < 1) return json({ error: 'Exact deal revision is required' }, 400);
      const responseAction = action === 'accept_offer' ? 'accept' : action === 'decline_offer' ? 'decline' : 'counter';

      const legs = await currentDealLegs(current, dealId);
      if (isComplexExchange(legs, current.appointment.club_id) && responseAction !== 'decline') {
        return json({
          error: 'This multi-player exchange is recorded safely, but accepting or countering it is disabled until #272 atomic exchange settlement is deployed.'
        }, 409);
      }

      const fee = Math.max(0, Number(body.fee ?? 0) || 0);
      const contractYears = Math.max(1, Math.min(5, Number(body.contract_years ?? body.contractYears ?? 3) || 3));
      const key = requestKey({
        user_id: current.user.id,
        world_id: current.appointment.world_id,
        action: responseAction,
        deal_id: dealId,
        revision_no: revisionNo,
        fee: responseAction === 'counter' ? fee : null,
        contract_years: responseAction === 'counter' ? contractYears : null,
        client_request_id: clientRequestId
      });
      const result = await serverSupabase('/rest/v1/rpc/respond_manager_transfer_deal_for_user', {
        method: 'POST',
        body: JSON.stringify({
          p_user_id: current.user.id,
          p_world_id: current.appointment.world_id,
          p_deal_id: dealId,
          p_revision_no: revisionNo,
          p_action: responseAction,
          p_fee: responseAction === 'counter' ? fee : null,
          p_contract_years: responseAction === 'counter' ? contractYears : null,
          p_request_key: key
        })
      });
      const message = responseAction === 'accept'
        ? 'Transfer terms agreed. A 15-minute mistake-grace period now applies before the deal becomes binding.'
        : responseAction === 'decline'
          ? 'Transfer offer declined.'
          : 'Counter-offer sent immediately.';
      return json({ accepted: true, action, deal: result, message });
    }

    if (['list', 'withdraw'].includes(action)) {
      const playerId = String(body.player_id || body.playerId || '').trim();
      const askingFee = Math.max(0, Number(body.asking_fee ?? body.askingFee ?? 0) || 0);
      if (!playerId) return json({ error: 'Player is required' }, 400);
      const key = requestKey({
        user_id: current.user.id,
        world_id: current.appointment.world_id,
        action,
        player_id: playerId,
        asking_fee: askingFee,
        client_request_id: clientRequestId
      });
      const rows = await serverSupabase('/rest/v1/rpc/set_manager_transfer_listing_for_user', {
        method: 'POST',
        body: JSON.stringify({
          p_user_id: current.user.id,
          p_world_id: current.appointment.world_id,
          p_player_id: playerId,
          p_action: action,
          p_asking_fee: askingFee,
          p_request_key: key
        })
      });
      const listing = Array.isArray(rows) ? rows[0] : rows;
      return json({ accepted: true, action, listing,
        message: action === 'withdraw' ? 'Transfer listing withdrawn immediately.' : 'Player listed for transfer immediately.' });
    }

    if (action === 'exchange_offer') {
      const counterpartClubId = String(body.counterpart_club_id || body.counterpartClubId || '').trim();
      if (!counterpartClubId) return json({ error: 'Counterpart club is required' }, 400);
      const legs = normalizeExchangeLegs(body.legs, {
        ownClubId: current.appointment.club_id,
        counterpartClubId
      });
      const key = requestKey({
        user_id: current.user.id,
        world_id: current.appointment.world_id,
        action,
        counterpart_club_id: counterpartClubId,
        legs,
        client_request_id: clientRequestId
      });
      const result = await serverSupabase('/rest/v1/rpc/set_manager_transfer_exchange_offer_for_user', {
        method: 'POST',
        body: JSON.stringify({
          p_user_id: current.user.id,
          p_world_id: current.appointment.world_id,
          p_counterpart_club_id: counterpartClubId,
          p_legs: legs,
          p_request_key: key
        })
      });
      return json({
        accepted: true,
        action,
        deal: result,
        message: 'Multi-player exchange offer recorded immediately. Acceptance remains locked until the atomic settlement slice is deployed.'
      });
    }

    if (['offer', 'withdraw_offer'].includes(action)) {
      const playerId = String(body.player_id || body.playerId || '').trim();
      const sellerClubId = String(body.seller_club_id || body.sellerClubId || '').trim();
      const fee = Math.max(0, Number(body.fee || 0) || 0);
      const contractYears = Math.max(1, Math.min(5, Number(body.contract_years ?? body.contractYears ?? 3) || 3));
      const dealId = String(body.deal_id || body.dealId || '').trim() || null;
      if (action === 'offer' && (!playerId || !sellerClubId)) return json({ error: 'Player and selling club are required' }, 400);
      if (action === 'withdraw_offer' && !dealId) return json({ error: 'Deal is required' }, 400);
      const key = requestKey({
        user_id: current.user.id,
        world_id: current.appointment.world_id,
        action,
        player_id: playerId,
        seller_club_id: sellerClubId,
        fee,
        contract_years: contractYears,
        deal_id: dealId,
        client_request_id: clientRequestId
      });
      const result = await serverSupabase('/rest/v1/rpc/set_manager_transfer_offer_for_user', {
        method: 'POST',
        body: JSON.stringify({
          p_user_id: current.user.id,
          p_world_id: current.appointment.world_id,
          p_action: action,
          p_player_id: playerId || null,
          p_seller_club_id: sellerClubId || null,
          p_fee: fee,
          p_contract_years: contractYears,
          p_deal_id: dealId,
          p_request_key: key
        })
      });
      return json({ accepted: true, action, deal: result,
        message: action === 'withdraw_offer' ? 'Transfer offer withdrawn immediately.' : 'Transfer offer sent immediately.' });
    }

    return json({ error: 'Unsupported transfer action' }, 400);
  } catch (error) {
    const message = String(error?.message || 'Transfer market request failed');
    const status = /Session|Authentication/.test(message) ? 401
      : /required|owned|listing action|response action|change response|agreed-deal change|mistake-grace|grace period|active transfer listing|read model|canonical world|appointment|selling club|counterpart club|exchange|offer|deal|revision|participant|approved|pending change/i.test(message) ? 409
        : 503;
    return json({ error: message }, status);
  }
};
