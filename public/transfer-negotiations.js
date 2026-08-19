const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const parseMoney = (value) => Math.max(0, Number(String(value ?? '').replace(/[^0-9.-]/g, '')) || 0);
const formatMoney = (value) => `£${parseMoney(value).toLocaleString('en-GB')}`;
const formatDeadline = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' });
};

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

function handleFirstClassResponseClick(event) {
  const button = event.target.closest('[data-deal-response]');
  if (!button) return false;
  respondFirstClassOffer(button);
  return true;
}

function handleAgreedChangeClick(event) {
  const button = event.target.closest('[data-agreed-change-action]');
  if (!button) return false;
  respondAgreedChange(button);
  return true;
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
      <div class="world-control-heading"><div><h2>Transfers</h2><p>Listings and negotiations are live immediately. Every counter or mutually agreed amendment creates a new immutable deal revision.</p></div><span id="transferNegotiationStatus" class="world-control-status">Loading…</span></div>
      <div class="transfer-negotiation-grid">
        <article class="transfer-negotiation-compose">
          <h3>New proposal</h3>
          <label>Action<select id="negotiationAction"><option value="offer">Make an offer</option><option value="listing">List an owned player</option></select></label>
          <label id="negotiationClubLabel">Selling club<select id="negotiationClub"></select></label>
          <label>Player<select id="negotiationPlayer"></select></label>
          <label>Fee<input id="negotiationFee" data-money-input type="text" inputmode="numeric" value="£0"></label>
          <label id="negotiationContractLabel">Proposed contract<select id="negotiationContractYears"><option value="1">1 season</option><option value="2">2 seasons</option><option value="3" selected>3 seasons</option><option value="4">4 seasons</option><option value="5">5 seasons</option></select></label>
          <button id="submitNegotiation" class="primary-action" type="button">Send offer now</button>
        </article>
        <article><h3>Incoming offers</h3><div id="incomingTransferOffers"></div></article>
        <article><h3>Outgoing offers</h3><div id="outgoingTransferOffers"></div></article>
        <article><h3>Your active listings</h3><div id="activeTransferListings"></div></article>
      </div>
      <p id="transferNegotiationMessage" class="world-control-message" aria-live="polite"></p>
      <aside class="transfer-legacy-note"><strong>Legacy request history</strong><p>Offers submitted before the first-class deal system remain in World request history. Outstanding legacy incoming offers can still be accepted or declined here; outstanding legacy outgoing offers can be withdrawn until the other club responds.</p></aside>
    </section>`;
  $('negotiationAction').addEventListener('change', renderComposer);
  $('negotiationClub').addEventListener('change', renderPlayerOptions);
  $('submitNegotiation').addEventListener('click', submitProposal);
  $('incomingTransferOffers').addEventListener('click', (event) => {
    if (handleFirstClassResponseClick(event)) return;
    if (handleAgreedChangeClick(event)) return;
    const button = event.target.closest('[data-legacy-transfer-response]');
    if (button) respondLegacyOffer(button.dataset.proposalId, button.dataset.legacyTransferResponse);
  });
  $('activeTransferListings').addEventListener('click', (event) => {
    const button = event.target.closest('[data-withdraw-listing]');
    if (button) withdrawListing(button.dataset.playerId);
  });
  $('outgoingTransferOffers').addEventListener('click', (event) => {
    if (handleFirstClassResponseClick(event)) return;
    if (handleAgreedChangeClick(event)) return;
    const legacyButton = event.target.closest('[data-withdraw-legacy-offer]');
    if (legacyButton) {
      withdrawLegacyOffer(legacyButton.dataset.proposalId);
      return;
    }
    const button = event.target.closest('[data-withdraw-offer]');
    if (button) withdrawOffer(button.dataset.dealId);
  });
  view.addEventListener('focusin', (event) => {
    if (event.target.matches?.('[data-money-input]')) event.target.value = String(parseMoney(event.target.value));
  });
  view.addEventListener('focusout', (event) => {
    if (event.target.matches?.('[data-money-input]')) event.target.value = formatMoney(event.target.value);
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

function revisionHistory(offer) {
  const revisions = offer.revision_history || [];
  if (revisions.length < 2) return '';
  return `<details class="transfer-revision-history"><summary>${revisions.length} deal revisions</summary>${revisions.map((revision) => {
    const summary = revision.summary || {};
    return `<div><strong>Revision ${escapeHtml(revision.revision_no)}</strong> · ${formatMoney(summary.fee || 0)} · ${escapeHtml(summary.contract_years || 3)} seasons</div>`;
  }).join('')}</details>`;
}

function lifecyclePresentation(offer) {
  const lifecycle = offer.lifecycle || {};
  if (lifecycle.effective_state === 'grace_period') {
    return {
      label: 'Deal agreed · mistake grace',
      detail: `Unilateral cancellation available until ${formatDeadline(lifecycle.grace_expires_at)} · transfer completes at ${formatDeadline(lifecycle.settle_at)}`,
      canCancelInGrace: Boolean(lifecycle.can_cancel_in_grace)
    };
  }
  if (lifecycle.effective_state === 'binding') {
    return {
      label: 'Deal binding · awaiting completion',
      detail: `Transfer completes at ${formatDeadline(lifecycle.settle_at)} · cancellation now requires mutual consent`,
      canCancelInGrace: false
    };
  }
  return {
    label: 'Terms agreed · awaiting completion',
    detail: lifecycle.settle_at ? `Transfer completes at ${formatDeadline(lifecycle.settle_at)}` : '',
    canCancelInGrace: false
  };
}

function agreedDealControls(offer) {
  const pending = offer.pending_change;
  const lifecycle = lifecyclePresentation(offer);
  if (pending) {
    const proposed = pending.change_type === 'amendment'
      ? `Amend to ${formatMoney(pending.proposed_fee || 0)} · ${escapeHtml(pending.proposed_contract_years || 3)} seasons`
      : 'Cancel this agreed transfer by mutual consent';
    if (pending.requested_by_you) {
      return `<div class="first-class-response-controls"><span class="world-control-status">${lifecycle.label}</span>${lifecycle.detail ? `<small>${escapeHtml(lifecycle.detail)}</small>` : ''}<small>${proposed} · awaiting other club</small></div>`;
    }
    return `<div class="first-class-response-controls">
      <span class="world-control-status">${lifecycle.label} · change proposed</span>
      ${lifecycle.detail ? `<small>${escapeHtml(lifecycle.detail)}</small>` : ''}
      <small>${proposed}</small>
      <div class="world-control-actions">
        <button type="button" class="primary-action" data-agreed-change-action="accept_agreed_change" data-change-request-id="${escapeHtml(pending.change_request_id)}">${pending.change_type === 'cancellation' ? 'Agree to cancel' : 'Accept amendment'}</button>
        <button type="button" data-agreed-change-action="reject_agreed_change" data-change-request-id="${escapeHtml(pending.change_request_id)}">Keep agreed deal</button>
      </div>
    </div>`;
  }
  const graceButton = lifecycle.canCancelInGrace
    ? `<button type="button" class="primary-action" data-agreed-change-action="cancel_in_grace" data-deal-id="${escapeHtml(offer.deal_id)}">Cancel during mistake grace</button>`
    : '';
  return `<div class="first-class-response-controls">
    <span class="world-control-status">${lifecycle.label}</span>
    ${lifecycle.detail ? `<small>${escapeHtml(lifecycle.detail)}</small>` : ''}
    ${graceButton}
    <div class="transfer-counter-controls">
      <label>Amended fee<input data-amendment-fee data-money-input type="text" inputmode="numeric" value="${escapeHtml(formatMoney(offer.fee || 0))}"></label>
      <label>Contract<select data-amendment-contract>${[1,2,3,4,5].map((years) => `<option value="${years}"${Number(offer.contract_years || 3) === years ? ' selected' : ''}>${years} season${years === 1 ? '' : 's'}</option>`).join('')}</select></label>
      <button type="button" data-agreed-change-action="propose_agreed_amendment" data-deal-id="${escapeHtml(offer.deal_id)}" data-revision-no="${escapeHtml(offer.revision_no)}">Propose amendment</button>
    </div>
    <button type="button" data-agreed-change-action="propose_agreed_cancellation" data-deal-id="${escapeHtml(offer.deal_id)}" data-revision-no="${escapeHtml(offer.revision_no)}">Propose cancellation</button>
  </div>`;
}

function responseControls(offer) {
  if (offer.status === 'agreed') return agreedDealControls(offer);
  if (!offer.requires_action) return '<span class="world-control-status">Awaiting other club</span>';
  return `<div class="first-class-response-controls">
    <div class="world-control-actions">
      <button type="button" class="primary-action" data-deal-response="accept_offer" data-deal-id="${escapeHtml(offer.deal_id)}" data-revision-no="${escapeHtml(offer.revision_no)}">Accept</button>
      <button type="button" data-deal-response="decline_offer" data-deal-id="${escapeHtml(offer.deal_id)}" data-revision-no="${escapeHtml(offer.revision_no)}">Decline</button>
    </div>
    <div class="transfer-counter-controls">
      <label>Counter fee<input data-counter-fee data-money-input type="text" inputmode="numeric" value="${escapeHtml(formatMoney(offer.fee || 0))}"></label>
      <label>Contract<select data-counter-contract>${[1,2,3,4,5].map((years) => `<option value="${years}"${Number(offer.contract_years || 3) === years ? ' selected' : ''}>${years} season${years === 1 ? '' : 's'}</option>`).join('')}</select></label>
      <button type="button" data-deal-response="counter_offer" data-deal-id="${escapeHtml(offer.deal_id)}" data-revision-no="${escapeHtml(offer.revision_no)}">Counter</button>
    </div>
  </div>`;
}

function offerCard(offer, { outgoing = false } = {}) {
  const suppliedName = outgoing ? offer.seller_club_name : offer.buyer_club_name;
  const counterpartId = outgoing ? offer.seller_club_id : offer.buyer_club_id;
  const counterpart = suppliedName && suppliedName !== counterpartId ? suppliedName : clubName(counterpartId);
  const label = outgoing ? `Offer to ${counterpart}` : `Offer from ${counterpart}`;
  const controls = offer.requires_action || offer.status === 'agreed'
    ? responseControls(offer)
    : outgoing
      ? `<button type="button" data-withdraw-offer data-deal-id="${escapeHtml(offer.deal_id)}">Withdraw offer</button>`
      : responseControls(offer);
  return `<article class="incoming-transfer-offer" data-first-class-deal="${escapeHtml(offer.deal_id)}">
    <div><strong>${escapeHtml(offer.player_name || offer.player_id)}</strong><span>${escapeHtml(label)} · ${formatMoney(offer.fee || 0)}</span><small>Revision ${escapeHtml(offer.revision_no || 1)} · ${escapeHtml(offer.contract_years || 3)}-season contract · ${escapeHtml(new Date(offer.updated_at || offer.created_at).toLocaleString('en-GB'))}</small>${revisionHistory(offer)}</div>
    <div class="world-control-actions">${controls}</div>
  </article>`;
}

function renderIncoming() {
  if (!$('incomingTransferOffers')) return 0;
  const firstClass = market?.incoming_offers || [];
  const legacy = state?.incoming_offers || [];
  const cards = firstClass.map((offer) => offerCard(offer));
  legacy.forEach((offer) => cards.push(`<article class="incoming-transfer-offer legacy-transfer-offer"><div><strong>${escapeHtml(offer.player_name)}</strong><span>Legacy offer from ${escapeHtml(offer.buyer_club_name)} · ${formatMoney(offer.fee || 0)}</span><small>Submitted before first-class negotiations · remains on the legacy response path</small></div><div class="world-control-actions"><button type="button" class="primary-action" data-legacy-transfer-response="accepted" data-proposal-id="${escapeHtml(offer.proposal_id)}">Accept</button><button type="button" data-legacy-transfer-response="declined" data-proposal-id="${escapeHtml(offer.proposal_id)}">Decline</button></div></article>`));
  $('incomingTransferOffers').innerHTML = cards.length ? cards.join('') : '<p>No transfer offers are awaiting your response.</p>';
  return cards.length;
}

function renderOutgoing() {
  if (!$('outgoingTransferOffers')) return 0;
  const offers = market?.outgoing_offers || [];
  const legacy = market?.legacy_outgoing_offers || [];
  const cards = offers.map((offer) => offerCard(offer, { outgoing: true }));
  legacy.forEach((offer) => {
    const sellerName = offer.seller_club_name || clubName(offer.seller_club_id);
    cards.push(`<article class="incoming-transfer-offer legacy-transfer-offer"><div><strong>${escapeHtml(offer.player_name || offer.player_id)}</strong><span>Legacy offer to ${escapeHtml(sellerName)} · ${formatMoney(offer.fee || 0)}</span><small>${escapeHtml(offer.contract_years || 3)}-season contract · submitted before first-class negotiations</small></div><div class="world-control-actions"><button type="button" data-withdraw-legacy-offer data-proposal-id="${escapeHtml(offer.proposal_id)}">Withdraw offer</button></div></article>`);
  });
  $('outgoingTransferOffers').innerHTML = cards.length ? cards.join('') : '<p>No active outgoing offers.</p>';
  return cards.length;
}

function renderListings() {
  if (!$('activeTransferListings')) return 0;
  const listings = (market?.listings || []).filter((listing) => listing.is_own_listing);
  $('activeTransferListings').innerHTML = listings.length ? listings.map((listing) => `
    <article class="incoming-transfer-offer">
      <div><strong>${escapeHtml(listing.player_name || listing.player_id)}</strong><span>Listed for ${formatMoney(listing.asking_fee || 0)}</span><small>Live now · updated ${escapeHtml(new Date(listing.updated_at).toLocaleString('en-GB'))}</small></div>
      <div class="world-control-actions"><button type="button" data-withdraw-listing data-player-id="${escapeHtml(listing.player_id)}">Withdraw listing</button></div>
    </article>`).join('') : '<p>No players are currently transfer listed.</p>';
  return listings.length;
}

function render() {
  if (!state || !mounted) return;
  renderComposer();
  const incomingCount = renderIncoming();
  const outgoingCount = renderOutgoing();
  const listingCount = renderListings();
  $('transferNegotiationStatus').textContent = `${incomingCount} incoming · ${outgoingCount} outgoing · ${listingCount} listed`;
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
      else if (!market) market = { listings: [], incoming_offers: [], outgoing_offers: [], legacy_outgoing_offers: [] };
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
      await request('/api/transfer-deals', { action: 'list', player_id: playerId, asking_fee: parseMoney($('negotiationFee').value), client_request_id: clientRequestId() });
      message.textContent = 'Player listed immediately. The listing is live now.';
    } else {
      await request('/api/transfer-deals', {
        action: 'offer',
        player_id: playerId,
        seller_club_id: $('negotiationClub').value,
        fee: parseMoney($('negotiationFee').value),
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

async function respondFirstClassOffer(button) {
  const card = button.closest('[data-first-class-deal]');
  const action = button.dataset.dealResponse;
  const dealId = button.dataset.dealId;
  const revisionNo = Number(button.dataset.revisionNo);
  const message = $('transferNegotiationMessage');
  const body = { action, deal_id: dealId, revision_no: revisionNo, client_request_id: clientRequestId() };
  if (action === 'counter_offer') {
    body.fee = parseMoney(card?.querySelector('[data-counter-fee]')?.value);
    body.contract_years = Number(card?.querySelector('[data-counter-contract]')?.value) || 3;
  }
  card?.querySelectorAll('[data-deal-response]').forEach((control) => { control.disabled = true; });
  message.textContent = action === 'accept_offer' ? 'Accepting exact deal revision…' : action === 'decline_offer' ? 'Declining transfer offer…' : 'Sending counter-offer…';
  try {
    const result = await request('/api/transfer-deals', body);
    message.textContent = result.message || 'Transfer negotiation updated.';
    await refresh({ force: true });
  } catch (error) {
    message.textContent = error.message;
    await refresh({ force: true }).catch(() => render());
  }
}

async function respondAgreedChange(button) {
  const card = button.closest('[data-first-class-deal]');
  const action = button.dataset.agreedChangeAction;
  const message = $('transferNegotiationMessage');
  const body = { action, client_request_id: clientRequestId() };
  if (action === 'cancel_in_grace') {
    body.deal_id = button.dataset.dealId;
  } else if (action === 'propose_agreed_amendment' || action === 'propose_agreed_cancellation') {
    body.deal_id = button.dataset.dealId;
    body.revision_no = Number(button.dataset.revisionNo);
    if (action === 'propose_agreed_amendment') {
      body.fee = parseMoney(card?.querySelector('[data-amendment-fee]')?.value);
      body.contract_years = Number(card?.querySelector('[data-amendment-contract]')?.value) || 3;
    }
  } else {
    body.change_request_id = button.dataset.changeRequestId;
  }
  card?.querySelectorAll('[data-agreed-change-action]').forEach((control) => { control.disabled = true; });
  message.textContent = action === 'cancel_in_grace' ? 'Cancelling during mistake grace…'
    : action === 'propose_agreed_amendment' ? 'Proposing amendment…'
      : action === 'propose_agreed_cancellation' ? 'Proposing mutual cancellation…'
        : action === 'accept_agreed_change' ? 'Confirming mutual change…'
          : 'Keeping existing agreed terms…';
  try {
    const result = await request('/api/transfer-deals', body);
    message.textContent = result.message || 'Agreed transfer updated.';
    await refresh({ force: true });
  } catch (error) {
    message.textContent = error.message;
    await refresh({ force: true }).catch(() => render());
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

async function withdrawLegacyOffer(proposalId) {
  const message = $('transferNegotiationMessage');
  message.textContent = 'Withdrawing legacy transfer offer…';
  document.querySelectorAll('[data-withdraw-legacy-offer]').forEach((button) => { button.disabled = true; });
  try {
    await request('/api/transfer-deals', { action: 'withdraw_legacy_offer', proposal_id: proposalId, client_request_id: clientRequestId() });
    message.textContent = 'Legacy transfer offer withdrawn immediately.';
    await refresh({ force: true });
  } catch (error) {
    message.textContent = error.message;
    renderOutgoing();
  }
}

async function respondLegacyOffer(proposalId, response) {
  const message = $('transferNegotiationMessage');
  message.textContent = `${response === 'accepted' ? 'Accepting' : 'Declining'} legacy transfer offer…`;
  document.querySelectorAll('[data-legacy-transfer-response]').forEach((button) => { button.disabled = true; });
  try {
    await request('/api/transfer-negotiations', { proposal_id: proposalId, response });
    message.textContent = response === 'accepted'
      ? 'Legacy offer accepted on the existing checkpoint workflow.'
      : 'Legacy offer declined.';
    await refresh({ force: true });
  } catch (error) {
    message.textContent = error.message;
    renderIncoming();
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
