const parseMoney = (value) => Math.max(0, Number(String(value ?? '').replace(/[^0-9.-]/g, '')) || 0);
const formatMoney = (value) => `£${parseMoney(value).toLocaleString('en-GB')}`;

let exchangeCache = null;
let exchangePromise = null;
let counterMode = null;
let scanTimer = null;
let reloadPending = false;

function storedAccessToken() {
  const bridged = String(window.tbgPortalAuthorization || '').trim();
  if (bridged) return bridged.toLowerCase().startsWith('bearer ') ? bridged.slice(7).trim() : bridged;
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key?.startsWith('sb-') || !key.endsWith('-auth-token')) continue;
    try {
      const stored = JSON.parse(localStorage.getItem(key));
      const token = stored?.access_token || stored?.currentSession?.access_token;
      if (token) return token;
    } catch {}
  }
  return '';
}

function clientRequestId() {
  return window.crypto?.randomUUID ? window.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function api(path, body = null) {
  const token = storedAccessToken();
  if (!token) throw new Error('Portal session is not ready');
  const response = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || data.message || `Transfer request failed (HTTP ${response.status})`);
  return data;
}

async function loadExchangeState({ force = false } = {}) {
  if (!force && exchangeCache) return exchangeCache;
  if (!force && exchangePromise) return exchangePromise;
  exchangePromise = api('/api/transfer-exchange-response')
    .then((result) => {
      exchangeCache = result;
      return result;
    })
    .finally(() => { exchangePromise = null; });
  return exchangePromise;
}

function exchangeForDeal(snapshot, dealId) {
  return (snapshot?.exchanges || []).find((offer) => String(offer.deal_id) === String(dealId));
}

function transferMessage(text) {
  const node = document.getElementById('transferNegotiationMessage');
  if (node) node.textContent = text;
}

function candidateExchangeCards() {
  return [...document.querySelectorAll('[data-first-class-deal]')].filter((card) =>
    !card.dataset.exchangeResponseUnlocked
    && Boolean(card.querySelector('[data-deal-response]'))
  );
}

function displayedRevision(card) {
  for (const node of card.querySelectorAll('small')) {
    const match = String(node.textContent || '').trim().match(/^Revision\s+(\d+)\b/i);
    if (match) return Number(match[1]);
  }
  return null;
}

function refreshStaleCard() {
  if (reloadPending) return;
  reloadPending = true;
  transferMessage('This transfer changed since it was displayed. Refreshing the latest revision before you can respond…');
  setTimeout(() => window.location.reload(), 80);
}

async function unlockVisibleExchangeCards() {
  const cards = candidateExchangeCards();
  if (!cards.length) return;
  const snapshot = await loadExchangeState().catch((error) => {
    transferMessage(error.message);
    return null;
  });
  if (!snapshot) return;

  for (const card of cards) {
    const dealId = card.dataset.firstClassDeal;
    const offer = exchangeForDeal(snapshot, dealId);
    if (!offer) continue;

    const revisionNo = Number(offer.revision_no || 0);
    const cardRevisionNo = displayedRevision(card);
    if (!revisionNo || cardRevisionNo !== revisionNo) {
      refreshStaleCard();
      return;
    }

    const controls = card.querySelector('.first-class-response-controls');
    if (!controls) continue;
    controls.innerHTML = `
      <small><strong>Exchange</strong> · respond to exact revision ${revisionNo}</small>
      <div class="world-control-actions transfer-exchange-response-actions">
        <button type="button" class="primary-action" data-exchange-response="accept" data-deal-id="${dealId}" data-revision-no="${revisionNo}">Accept</button>
        <button type="button" data-exchange-response="counter" data-deal-id="${dealId}" data-revision-no="${revisionNo}">Counter</button>
        <button type="button" data-exchange-response="decline" data-deal-id="${dealId}" data-revision-no="${revisionNo}">Decline</button>
      </div>`;
    card.dataset.exchangeResponseUnlocked = 'true';
  }
}

function scheduleScan() {
  clearTimeout(scanTimer);
  scanTimer = setTimeout(() => unlockVisibleExchangeCards().catch((error) => transferMessage(error.message)), 60);
}

function clearSelectedPlayers() {
  let remove = document.querySelector('[data-remove-exchange-player]');
  while (remove) {
    remove.click();
    remove = document.querySelector('[data-remove-exchange-player]');
  }
}

function counterpartFromLegs(offer, ownClubId) {
  const clubIds = new Set();
  for (const leg of offer?.legs || []) {
    if (leg.from_club_id) clubIds.add(String(leg.from_club_id));
    if (leg.to_club_id) clubIds.add(String(leg.to_club_id));
  }
  clubIds.delete(String(ownClubId));
  return [...clubIds][0] || '';
}

function addPlayerToComposer(side, leg) {
  const playerSelect = document.getElementById(side === 'receive' ? 'receivePlayer' : 'offerPlayer');
  const contractSelect = document.getElementById(side === 'receive' ? 'receiveContractYears' : 'offerContractYears');
  const addButton = document.getElementById(side === 'receive' ? 'addReceivePlayer' : 'addOfferPlayer');
  if (!playerSelect || !contractSelect || !addButton) throw new Error('Transfer composer is not ready');
  playerSelect.value = String(leg.player_id || '');
  if (!playerSelect.value) throw new Error(`Player ${leg.player_name || leg.player_id} is no longer available for this counter-offer`);
  contractSelect.value = String(leg.contract_years || 3);
  addButton.click();
}

function ensureCancelCounterButton() {
  let button = document.getElementById('cancelExchangeCounter');
  if (button) return button;
  button = document.createElement('button');
  button.id = 'cancelExchangeCounter';
  button.type = 'button';
  button.textContent = 'Cancel counter';
  document.getElementById('submitNegotiation')?.after(button);
  button.addEventListener('click', () => window.location.reload());
  return button;
}

async function beginCounter(dealId, revisionNo) {
  const snapshot = await loadExchangeState({ force: true });
  const offer = exchangeForDeal(snapshot, dealId);
  if (!offer) throw new Error('This exchange revision is no longer available');
  if (Number(offer.revision_no) !== Number(revisionNo)) {
    refreshStaleCard();
    throw new Error('This exchange changed before the counter editor opened. Refreshing the latest revision.');
  }
  const ownClubId = String(snapshot.club_id || '');
  const counterpartClubId = counterpartFromLegs(offer, ownClubId);
  if (!ownClubId || !counterpartClubId) throw new Error('Could not resolve the two clubs in this exchange');

  const action = document.getElementById('negotiationAction');
  const club = document.getElementById('negotiationClub');
  if (!action || !club) throw new Error('Transfer composer is not ready');
  action.value = 'offer';
  action.dispatchEvent(new Event('change', { bubbles: true }));
  club.value = counterpartClubId;
  club.dispatchEvent(new Event('change', { bubbles: true }));
  clearSelectedPlayers();

  const receiveCash = document.getElementById('receiveCash');
  const offerCash = document.getElementById('offerCash');
  if (receiveCash) receiveCash.value = '£0';
  if (offerCash) offerCash.value = '£0';

  for (const leg of offer.legs || []) {
    if (leg.leg_type === 'permanent_transfer') {
      if (String(leg.to_club_id) === ownClubId) addPlayerToComposer('receive', leg);
      else if (String(leg.from_club_id) === ownClubId) addPlayerToComposer('offer', leg);
    } else if (leg.leg_type === 'cash') {
      if (String(leg.to_club_id) === ownClubId && receiveCash) receiveCash.value = formatMoney(leg.amount || 0);
      else if (String(leg.from_club_id) === ownClubId && offerCash) offerCash.value = formatMoney(leg.amount || 0);
    }
  }

  counterMode = { dealId, revisionNo, ownClubId, counterpartClubId };
  action.disabled = true;
  club.disabled = true;
  const submit = document.getElementById('submitNegotiation');
  if (submit) {
    submit.disabled = false;
    submit.textContent = 'Send counter-offer';
  }
  ensureCancelCounterButton();
  transferMessage(`Editing counter-offer to revision ${revisionNo}. Change any players, contracts or cash, then send the complete replacement revision.`);
  document.querySelector('.transfer-negotiation-compose')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function counterLegsFromComposer() {
  if (!counterMode) return [];
  const legs = [];
  document.querySelectorAll('#receivePlayersSelected [data-exchange-contract-player]').forEach((select) => {
    legs.push({
      leg_type: 'permanent_transfer',
      from_club_id: counterMode.counterpartClubId,
      to_club_id: counterMode.ownClubId,
      player_id: select.dataset.exchangeContractPlayer,
      contract_years: Number(select.value) || 3
    });
  });
  document.querySelectorAll('#offerPlayersSelected [data-exchange-contract-player]').forEach((select) => {
    legs.push({
      leg_type: 'permanent_transfer',
      from_club_id: counterMode.ownClubId,
      to_club_id: counterMode.counterpartClubId,
      player_id: select.dataset.exchangeContractPlayer,
      contract_years: Number(select.value) || 3
    });
  });
  const receiveCash = parseMoney(document.getElementById('receiveCash')?.value);
  const offerCash = parseMoney(document.getElementById('offerCash')?.value);
  if (receiveCash > 0 && offerCash > 0) throw new Error('Cash must move in one direction only');
  if (receiveCash > 0) legs.push({ leg_type: 'cash', from_club_id: counterMode.counterpartClubId, to_club_id: counterMode.ownClubId, amount: receiveCash });
  if (offerCash > 0) legs.push({ leg_type: 'cash', from_club_id: counterMode.ownClubId, to_club_id: counterMode.counterpartClubId, amount: offerCash });
  if (!legs.some((leg) => leg.leg_type === 'permanent_transfer')) throw new Error('A counter-offer must include at least one player');
  return legs;
}

async function sendCounter() {
  const submit = document.getElementById('submitNegotiation');
  if (submit) submit.disabled = true;
  transferMessage('Sending complete counter-offer revision…');
  try {
    const result = await api('/api/transfer-exchange-response', {
      action: 'counter',
      deal_id: counterMode.dealId,
      revision_no: counterMode.revisionNo,
      legs: counterLegsFromComposer(),
      client_request_id: clientRequestId()
    });
    transferMessage(result.message || 'Exchange counter-offer sent.');
    exchangeCache = null;
    setTimeout(() => window.location.reload(), 250);
  } catch (error) {
    transferMessage(error.message);
    if (submit) submit.disabled = false;
  }
}

async function respond(button) {
  const action = button.dataset.exchangeResponse;
  const dealId = button.dataset.dealId;
  const revisionNo = Number(button.dataset.revisionNo);
  if (action === 'counter') {
    await beginCounter(dealId, revisionNo);
    return;
  }

  const latest = await loadExchangeState({ force: true });
  const offer = exchangeForDeal(latest, dealId);
  if (!offer || Number(offer.revision_no) !== revisionNo) {
    refreshStaleCard();
    throw new Error('This exchange changed before your response was submitted. Refreshing the latest revision.');
  }

  const card = button.closest('[data-first-class-deal]');
  if (displayedRevision(card) !== revisionNo) {
    refreshStaleCard();
    throw new Error('The displayed transfer terms are stale. Refreshing the latest revision.');
  }
  card?.querySelectorAll('[data-exchange-response]').forEach((control) => { control.disabled = true; });
  transferMessage(action === 'accept' ? 'Accepting exact exchange revision…' : 'Declining exchange offer…');
  try {
    const result = await api('/api/transfer-exchange-response', {
      action,
      deal_id: dealId,
      revision_no: revisionNo,
      client_request_id: clientRequestId()
    });
    transferMessage(result.message || 'Exchange negotiation updated.');
    exchangeCache = null;
    setTimeout(() => window.location.reload(), 250);
  } catch (error) {
    transferMessage(error.message);
    card?.querySelectorAll('[data-exchange-response]').forEach((control) => { control.disabled = false; });
  }
}

document.addEventListener('click', (event) => {
  const responseButton = event.target.closest('[data-exchange-response]');
  if (responseButton) {
    event.preventDefault();
    event.stopImmediatePropagation();
    respond(responseButton).catch((error) => transferMessage(error.message));
    return;
  }

  const submit = event.target.closest('#submitNegotiation');
  if (submit && counterMode) {
    event.preventDefault();
    event.stopImmediatePropagation();
    sendCounter().catch((error) => transferMessage(error.message));
  }
}, true);

window.addEventListener('tbg:portal-rendered', scheduleScan);
document.addEventListener('tbg:view-changed', (event) => {
  if (event.detail?.view === 'transfers') {
    exchangeCache = null;
    scheduleScan();
  }
});

new MutationObserver(scheduleScan).observe(document.documentElement, { childList: true, subtree: true });
scheduleScan();
