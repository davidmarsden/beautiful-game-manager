const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));

let authorization = '';
let state = null;
let market = null;
let mounted = false;
let lastRefreshAt = 0;
let refreshPromise = null;
let refreshGeneration = 0;
const TRANSFER_REFRESH_TTL_MS = 60_000;
const nativeFetch = window.fetch.bind(window);
window.fetch = async (...args) => {
  const headers = args[1]?.headers || (args[0] instanceof Request ? args[0].headers : null);
  const auth = headers instanceof Headers ? headers.get('authorization') : headers?.authorization;
  if (auth) authorization = auth;
  return nativeFetch(...args);
};

const $ = (id) => document.getElementById(id);

async function responseBody(response) {
  const text = await response.text();
  if (!text) return { parsed: true, data: {} };
  try { return { parsed: true, data: JSON.parse(text) }; }
  catch { return { parsed: false, data: {}, raw: text.slice(0, 300) }; }
}

async function request(path, body = null) {
  if (!authorization) throw new Error('Portal session is not ready');
  const response = await nativeFetch(path, {
    method: body ? 'POST' : 'GET',
    headers: { authorization, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const result = await responseBody(response);
  const data = result.data;
  if (!response.ok) {
    const serverFallback = `The transfer service is temporarily unavailable. Your request was not recorded; please try again later. (HTTP ${response.status})`;
    const detail = response.status >= 500 && !result.parsed
      ? serverFallback
      : data.error || data.message || (response.status >= 500 ? serverFallback : `Transfer request failed (HTTP ${response.status})`);
    throw new Error(detail);
  }
  return data;
}

function ensureTransfersView() {
  const workspace = document.querySelector('.workspace');
  if (!workspace) return null;
  const tabs = workspace.querySelector('.tabs');
  if (tabs && !tabs.querySelector('[data-view="transfers"]')) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.view = 'transfers';
    button.textContent = 'Transfers';
    const competition = tabs.querySelector('[data-view="competitions"]');
    if (competition) competition.before(button);
    else tabs.append(button);
  }
  let view = $('transfersView');
  if (!view) {
    view = document.createElement('div');
    view.id = 'transfersView';
    view.className = 'view';
    view.hidden = true;
    workspace.append(view);
  }
  return view;
}

function mount() {
  if (mounted) return;
  const view = ensureTransfersView();
  if (!view) return;
  mounted = true;
  const legacy = document.querySelector('.world-transfer-card');
  if (legacy) legacy.hidden = true;
  const oldWorkspace = $('transferNegotiationWorkspace');
  oldWorkspace?.remove();
  view.innerHTML = `
    <section id="transferNegotiationWorkspace" class="world-control-card transfer-negotiation-workspace">
      <div class="world-control-heading"><div><h2>Transfers</h2><p>Listings and new offers are live immediately and no longer wait for a matchday checkpoint.</p></div><span id="transferNegotiationStatus" class="world-control-status">Loading…</span></div>
      <div class="transfer-negotiation-grid">
        <article class="transfer-negotiation-compose">
          <h3>New proposal</h3>
          <label>Action<select id="negotiationAction"><option value="offer">Make an offer</option><option value="listing">List an owned player</option></select></label>
          <label id="negotiationClubLabel">Selling club<select id="negotiationClub"></select></label>
          <label>Player<select id="negotiationPlayer"></select></label>
          <label>Fee<input id="negotiationFee" type="number" min="0" step="1" value="0"></label>
          <label id="negotiationContractLabel">Proposed contract<select id="negotiationContractYears"><option value="1">1 season</option><option value="2">2 seasons</option><option value="3" selected>3 seasons</option><option value="4">4 seasons</option><option value="5">5 seasons</option></select></label>
          <button id="submitNegotiation" class="primary-action" type="button">Send offer now</button>
        </article>
        <article><h3>Incoming offers</h3><div id="incomingTransferOffers"></div></article>
        <article><h3>Outgoing offers</h3><div id="outgoingTransferOffers"></div></article>
        <article><h3>Your active listings</h3><div id="activeTransferListings"></div></article>
      </div>
      <p id="transferNegotiationMessage" class="world-control-message" aria-live="polite"></p>
      <aside class="transfer-legacy-note"><strong>Legacy request history</strong><p>Offers submitted before the first-class deal system remain in World request history. They are preserved as audit records and are not rewritten.</p></aside>
    </section>`;
  $('negotiationAction').addEventListener('change', renderComposer);
  $('negotiationClub').addEventListener('change', renderPlayerOptions);
  $('submitNegotiation').addEventListener('click', submitProposal);
  $('activeTransferListings').addEventListener('click', (event) => {
    const button = event.target.closest('[data-withdraw-listing]');
    if (button) withdrawListing(button.dataset.playerId);
  });
  $('outgoingTransferOffers').addEventListener('click', (event) => {
    const button = event.target.closest('[data-withdraw-offer]');
    if (button) withdrawOffer(button.dataset.dealId);
  });
}

function clubs() { return state?.directory?.clubs || []; }
function players() { return state?.directory?.players || []; }

function clubName(clubId) {
  return clubs().find((club) => club.club_id === clubId)?.club_name || clubId;
}

function renderComposer() {
  if (!$('negotiationAction')) return;
  const action = $('negotiationAction').value;
  const ownClub = state?.club_id;
  $('negotiationClubLabel').hidden = action === 'listing';
  $('negotiationContractLabel').hidden = action === 'listing';
  const managedCounterparts = clubs().filter((club) => club.club_id !== ownClub && club.managed);
  $('negotiationClub').innerHTML = managedCounterparts.map((club) => `<option value="${escapeHtml(club.club_id)}">${escapeHtml(club.club_name)}</option>`).join('');
  $('submitNegotiation').textContent = action === 'listing' ? 'List player now' : 'Send offer now';
  if (action === 'offer' && !managedCounterparts.length) {
    $('negotiationPlayer').innerHTML = '<option value="">No other human-managed clubs available</option>';
    $('submitNegotiation').disabled = true;
    return;
  }
  renderPlayerOptions();
}

function renderPlayerOptions() {
  if (!$('negotiationAction')) return;
  const action = $('negotiationAction').value;
  const clubId = action === 'listing' ? state?.club_id : $('negotiationClub').value;
  const options = players().filter((player) => player.club_id === clubId)
    .map((player) => `<option value="${escapeHtml(player.player_id)}">${escapeHtml(player.player_name)} · ${escapeHtml(player.position)}${player.rating ? ` · ${escapeHtml(player.rating)}` : ''}</option>`).join('');
  $('negotiationPlayer').innerHTML = options || '<option value="">No players available</option>';
  $('submitNegotiation').disabled = !options;
}

function offerCard(offer, { outgoing = false } = {}) {
  const counterpart = outgoing ? (offer.seller_club_name || clubName(offer.seller_club_id)) : (offer.buyer_club_name || clubName(offer.buyer_club_id));
  const label = outgoing ? `Offer to ${counterpart}` : `Offer from ${counterpart}`;
  return `<article class="incoming-transfer-offer">
    <div><strong>${escapeHtml(offer.player_name || offer.player_id)}</strong><span>${escapeHtml(label)} · £${Number(offer.fee || 0).toLocaleString('en-GB')}</span><small>${escapeHtml(offer.contract_years || 3)}-season contract · ${escapeHtml(new Date(offer.created_at).toLocaleString('en-GB'))}</small></div>
    ${outgoing ? `<div class="world-control-actions"><button type="button" data-withdraw-offer data-deal-id="${escapeHtml(offer.deal_id)}">Withdraw offer</button></div>` : '<div class="world-control-actions"><span class="world-control-status">Awaiting response controls</span></div>'}
  </article>`;
}

function renderIncoming() {
  if (!$('incomingTransferOffers')) return;
  const firstClass = market?.incoming_offers || [];
  const legacy = state?.incoming_offers || [];
  const cards = firstClass.map((offer) => offerCard(offer));
  legacy.forEach((offer) => cards.push(`<article class="incoming-transfer-offer legacy-transfer-offer"><div><strong>${escapeHtml(offer.player_name)}</strong><span>Legacy offer from ${escapeHtml(offer.buyer_club_name)} · £${Number(offer.fee || 0).toLocaleString('en-GB')}</span><small>Submitted before first-class negotiations · response remains in the legacy workflow</small></div></article>`));
  $('incomingTransferOffers').innerHTML = cards.length ? cards.join('') : '<p>No transfer offers are awaiting your response.</p>';
}

function renderOutgoing() {
  if (!$('outgoingTransferOffers')) return;
  const offers = market?.outgoing_offers || [];
  $('outgoingTransferOffers').innerHTML = offers.length ? offers.map((offer) => offerCard(offer, { outgoing: true })).join('') : '<p>No active outgoing first-class offers.</p>';
}

function renderListings() {
  if (!$('activeTransferListings')) return;
  const listings = (market?.listings || []).filter((listing) => listing.is_own_listing);
  $('activeTransferListings').innerHTML = listings.length ? listings.map((listing) => `
    <article class="incoming-transfer-offer">
      <div><strong>${escapeHtml(listing.player_name || listing.player_id)}</strong><span>Listed for £${Number(listing.asking_fee || 0).toLocaleString('en-GB')}</span><small>Live now · updated ${escapeHtml(new Date(listing.updated_at).toLocaleString('en-GB'))}</small></div>
      <div class="world-control-actions"><button type="button" data-withdraw-listing data-player-id="${escapeHtml(listing.player_id)}">Withdraw listing</button></div>
    </article>`).join('') : '<p>No players are currently transfer listed.</p>';
}

function render() {
  if (!state || !mounted) return;
  const listingCount = (market?.listings || []).filter((listing) => listing.is_own_listing).length;
  const outgoingCount = market?.outgoing_offers?.length || 0;
  const incomingCount = (market?.incoming_offers?.length || 0) + (state?.incoming_offers?.length || 0);
  $('transferNegotiationStatus').textContent = `${incomingCount} incoming · ${outgoingCount} outgoing · ${listingCount} listed`;
  renderComposer();
  renderIncoming();
  renderOutgoing();
  renderListings();
}

async function refresh({ force = false } = {}) {
  mount();
  const now = Date.now();
  if (!force && state && market && now - lastRefreshAt < TRANSFER_REFRESH_TTL_MS) {
    render();
    return state;
  }
  if (!force && refreshPromise) return refreshPromise;
  const generation = ++refreshGeneration;
  const nextPromise = Promise.allSettled([request('/api/transfer-negotiations'), request('/api/transfer-deals')])
    .then(([negotiationResult, marketResult]) => {
      if (generation !== refreshGeneration) return state;
      if (negotiationResult.status === 'fulfilled') state = negotiationResult.value;
      else if (!state) throw negotiationResult.reason;
      if (marketResult.status === 'fulfilled') market = marketResult.value;
      else if (!market) market = { listings: [], incoming_offers: [], outgoing_offers: [] };
      lastRefreshAt = Date.now();
      render();
      return state;
    })
    .finally(() => { if (refreshPromise === nextPromise) refreshPromise = null; });
  refreshPromise = nextPromise;
  return nextPromise;
}

function clientRequestId() {
  return window.crypto?.randomUUID ? window.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function submitProposal() {
  const message = $('transferNegotiationMessage');
  const action = $('negotiationAction').value;
  const playerId = $('negotiationPlayer').value;
  if (!playerId) return;
  message.textContent = action === 'listing' ? 'Publishing transfer listing…' : 'Sending transfer offer…';
  $('submitNegotiation').disabled = true;
  try {
    if (action === 'listing') {
      await request('/api/transfer-deals', { action: 'list', player_id: playerId, asking_fee: Number($('negotiationFee').value) || 0, client_request_id: clientRequestId() });
      message.textContent = 'Player listed immediately. The listing is live now.';
    } else {
      await request('/api/transfer-deals', {
        action: 'offer',
        player_id: playerId,
        seller_club_id: $('negotiationClub').value,
        fee: Number($('negotiationFee').value) || 0,
        contract_years: Number($('negotiationContractYears').value) || 3,
        client_request_id: clientRequestId()
      });
      message.textContent = 'Offer sent immediately. You can withdraw it from Outgoing offers while it remains negotiable.';
    }
    await refresh({ force: true });
  } catch (error) {
    message.textContent = error.message;
  } finally {
    renderPlayerOptions();
  }
}

async function withdrawListing(playerId) {
  const message = $('transferNegotiationMessage');
  message.textContent = 'Withdrawing transfer listing…';
  try {
    await request('/api/transfer-deals', { action: 'withdraw', player_id: playerId, client_request_id: clientRequestId() });
    message.textContent = 'Transfer listing withdrawn immediately.';
    await refresh({ force: true });
  } catch (error) { message.textContent = error.message; }
}

async function withdrawOffer(dealId) {
  const message = $('transferNegotiationMessage');
  message.textContent = 'Withdrawing transfer offer…';
  document.querySelectorAll('[data-withdraw-offer]').forEach((button) => { button.disabled = true; });
  try {
    await request('/api/transfer-deals', { action: 'withdraw_offer', deal_id: dealId, client_request_id: clientRequestId() });
    message.textContent = 'Transfer offer withdrawn immediately.';
    await refresh({ force: true });
  } catch (error) {
    message.textContent = error.message;
    renderOutgoing();
  }
}

window.addEventListener('tbg:portal-rendered', async () => {
  mount();
  try { await refresh(); }
  catch (error) {
    if ($('transferNegotiationStatus')) $('transferNegotiationStatus').textContent = 'Unavailable';
    if ($('transferNegotiationMessage')) $('transferNegotiationMessage').textContent = error.message;
  }
});

document.addEventListener('tbg:view-changed', (event) => {
  if (event.detail?.view === 'transfers') refresh().catch(() => {});
});
