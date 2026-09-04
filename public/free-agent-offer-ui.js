const offerEscape = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const offerMoney = (value) => `£${Math.max(0, Number(value) || 0).toLocaleString('en-GB')}`;
let latestFreeAgentOffers = [];
let outgoingObserver = null;
let observedOutgoing = null;

function transfersActive() {
  return document.getElementById('transfersView')?.classList.contains('active') === true;
}

function accessToken() {
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

async function api(path, body = null) {
  const token = accessToken();
  if (!token) throw new Error('Sign in to make a free-agent offer.');
  const response = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || data.message || `Free-agent request failed (HTTP ${response.status})`);
  return data;
}

function requestId(playerId) {
  const key = `tbg-free-agent-offer-request:${playerId}`;
  let value = sessionStorage.getItem(key);
  if (!value) {
    value = window.crypto?.randomUUID ? window.crypto.randomUUID() : `${Date.now()}-${playerId}`;
    sessionStorage.setItem(key, value);
  }
  return { key, value };
}

function formatDecision(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' });
}

function statusLabel(offer) {
  if (offer.status === 'pending') return `Decision by ${formatDecision(offer.decision_at)}`;
  if (offer.status === 'accepted') return 'Accepted';
  if (offer.status === 'application_failed') return 'Could not complete';
  if (offer.status === 'withdrawn') return 'Withdrawn';
  return 'Rejected';
}

function offerReason(offer) {
  const reason = String(offer.decision_reason || '');
  if (reason.startsWith('terms_below_expectation')) return 'The player felt the terms were not attractive enough.';
  if (reason.startsWith('player_chose_other_club')) return 'The player chose another club.';
  if (reason.startsWith('player_accepted_best_offer')) return 'The player chose this offer.';
  if (reason === 'manager_withdrew_offer') return 'You withdrew this offer.';
  return reason.replaceAll('_', ' ');
}

function offerSourceLabel(offer) {
  const type = String(offer.player_snapshot?.assignment_status || offer.player_snapshot?.acquisition_type || '').toLowerCase();
  return type === 'external' || type.includes('external_transfermarkt') ? 'External player' : 'Free agent';
}

function pendingWithdrawButton(offer) {
  if (offer.status !== 'pending') return '';
  return `<button type="button" data-withdraw-open-market-offer="${offerEscape(offer.id)}" data-withdraw-open-market-tm-id="${offerEscape(offer.transfermarkt_id || '')}">Cancel offer</button>`;
}

function renderOfferPanel(offers = []) {
  const panel = document.getElementById('openMarketPanel');
  if (!panel || !document.querySelector('[data-open-market-tab="free-agents"][aria-selected="true"]')) return;
  let host = document.getElementById('freeAgentOfferStatusPanel');
  if (!host) {
    host = document.createElement('section');
    host.id = 'freeAgentOfferStatusPanel';
    host.className = 'open-market-external-note';
    const results = panel.querySelector('.open-market-results');
    if (results) panel.insertBefore(host, results);
    else panel.append(host);
  }
  const recent = offers.slice(0, 8);
  const html = `<strong>Your open-market offers</strong>${recent.length ? recent.map((offer) => `
    <div style="margin-top:.55rem">
      <strong>${offerEscape(offer.player_name || offer.player_id)}</strong>
      <small>${offerEscape(offerSourceLabel(offer))} · ${offerMoney(offer.wage)} / week · ${offerEscape(offer.contract_years)} season${Number(offer.contract_years) === 1 ? '' : 's'} · ${offerEscape(statusLabel(offer))}</small>
      ${offer.status !== 'pending' && offer.decision_reason ? `<small>${offerEscape(offerReason(offer))}</small>` : ''}
      ${pendingWithdrawButton(offer)}
    </div>`).join('') : '<p class="open-market-empty">No open-market offers submitted yet.</p>'}`;
  if (host.innerHTML !== html) host.innerHTML = html;
}

function nativeOutgoingOfferCount(outgoing) {
  return outgoing
    ? outgoing.querySelectorAll(':scope > article.incoming-transfer-offer').length
    : 0;
}

function restoreOutgoingEmptyState(outgoing) {
  if (!outgoing || nativeOutgoingOfferCount(outgoing)) return;
  const hasOpenMarket = Boolean(outgoing.querySelector('[data-open-market-outgoing-summary]'));
  const hasEmptyState = Array.from(outgoing.children).some((child) => child.tagName === 'P' && (child.textContent || '').trim() === 'No active outgoing offers.');
  if (!hasOpenMarket && !hasEmptyState) {
    const empty = document.createElement('p');
    empty.textContent = 'No active outgoing offers.';
    outgoing.append(empty);
  }
}

function renderPendingOffersInTransferSummary(offers = []) {
  const pending = offers.filter((offer) => offer.status === 'pending');
  const outgoing = document.getElementById('outgoingTransferOffers');
  if (outgoing) {
    let host = outgoing.querySelector('[data-open-market-outgoing-summary]');
    const legacyHost = outgoing.querySelector('[data-free-agent-outgoing-summary]');
    if (legacyHost && !host) {
      legacyHost.dataset.openMarketOutgoingSummary = 'true';
      delete legacyHost.dataset.freeAgentOutgoingSummary;
      host = legacyHost;
    }
    const emptyState = Array.from(outgoing.children).find((child) => child.tagName === 'P' && (child.textContent || '').trim() === 'No active outgoing offers.');
    if (!pending.length) {
      host?.remove();
      restoreOutgoingEmptyState(outgoing);
    } else {
      emptyState?.remove();
      if (!host) {
        host = document.createElement('div');
        host.dataset.openMarketOutgoingSummary = 'true';
        outgoing.append(host);
      }
      const html = pending.map((offer) => `
        <div class="transfer-free-agent-pending" style="margin-top:.55rem">
          <strong>${offerEscape(offer.player_name || offer.player_id)}</strong>
          <small>${offerEscape(offerSourceLabel(offer))} · ${offerMoney(offer.wage)} / week · ${offerEscape(offer.contract_years)} season${Number(offer.contract_years) === 1 ? '' : 's'}</small>
          <small>Awaiting player decision · ${offerEscape(formatDecision(offer.decision_at))}</small>
          ${pendingWithdrawButton(offer)}
        </div>`).join('');
      if (host.innerHTML !== html) host.innerHTML = html;
    }
  }

  const status = document.getElementById('transferNegotiationStatus');
  const match = status?.textContent?.match(/^(\d+) incoming · (\d+) outgoing · (\d+) listed$/);
  if (status && match) {
    const nativeOutgoing = outgoing ? nativeOutgoingOfferCount(outgoing) : Math.max(0, Number(match[2]) || 0);
    const nextText = `${match[1]} incoming · ${nativeOutgoing + pending.length} outgoing · ${match[3]} listed`;
    if (status.textContent !== nextText) status.textContent = nextText;
  }
}

function restyleFreeAgentUi() {
  if (!transfersActive()) return;
  document.querySelectorAll('[data-sign-free-agent]').forEach((button) => {
    if (button.textContent !== 'Make offer') button.textContent = 'Make offer';
    if (button.getAttribute('aria-label') !== 'Make contract offer') button.setAttribute('aria-label', 'Make contract offer');
  });
  const message = document.getElementById('openMarketMessage');
  if (message && /Signing is settled directly into the live world/i.test(message.textContent || '')) {
    message.textContent = 'Free agents can receive offers from several clubs. Submit contract terms and the player will choose after the six-hour offer window; unattractive offers can be rejected.';
  }
  renderOfferPanel(latestFreeAgentOffers);
  renderPendingOffersInTransferSummary(latestFreeAgentOffers);
}

async function refreshOffers() {
  if (!transfersActive() || !document.getElementById('openMarketWorkspace')) return;
  try {
    const data = await api('/api/free-agents?q=__offer_status_only__&limit=1');
    if (!transfersActive()) return;
    const offers = Array.isArray(data.offers) ? data.offers : [];
    latestFreeAgentOffers = offers;
    restyleFreeAgentUi();
    const newlyAccepted = offers.find((offer) => offer.status === 'accepted' && !sessionStorage.getItem(`tbg-free-agent-accepted-seen:${offer.id}`));
    if (newlyAccepted) {
      sessionStorage.setItem(`tbg-free-agent-accepted-seen:${newlyAccepted.id}`, '1');
      sessionStorage.setItem('tbg:return-view', 'transfers');
      window.location.reload();
    }
  } catch {}
}

async function submitOffer(button) {
  const playerId = String(button.dataset.signFreeAgent || '').trim();
  const card = button.closest('[data-free-agent-card]');
  const years = Number(card?.querySelector('[data-free-agent-years]')?.value || 3);
  const wageInput = card?.querySelector('[data-free-agent-wage]');
  const wage = Number.isFinite(Number(wageInput?.value)) ? Math.max(0, Math.round(Number(wageInput.value))) : 1000;
  const request = requestId(playerId);
  const message = document.getElementById('openMarketMessage');
  button.disabled = true;
  button.textContent = 'Offering…';
  try {
    const data = await api('/api/free-agents', {
      action: 'offer',
      player_id: playerId,
      transfermarkt_id: button.dataset.tmId || undefined,
      contract_years: years,
      wage,
      client_request_id: request.value
    });
    sessionStorage.removeItem(request.key);
    if (message) {
      const playerName = data.offer?.player_name || card?.querySelector('strong')?.textContent || playerId;
      message.textContent = data.offer?.idempotent
        ? `Your offer to ${playerName} is already awaiting the player's decision.`
        : `Offer submitted to ${playerName}. The player can consider competing offers until ${formatDecision(data.decision_at)}.`;
    }
    const status = document.getElementById('openMarketStatus');
    if (status) status.textContent = 'Offer submitted';
    await refreshOffers();
  } catch (error) {
    if (message) message.textContent = error.message;
    button.disabled = false;
    if (button.textContent !== 'Make offer') button.textContent = 'Make offer';
  }
}

async function withdrawOpenMarketOffer(button) {
  const offerId = String(button.dataset.withdrawOpenMarketOffer || '').trim();
  if (!offerId) return;
  const offer = latestFreeAgentOffers.find((row) => String(row.id) === offerId);
  const message = document.getElementById('openMarketMessage') || document.getElementById('transferNegotiationMessage');
  button.disabled = true;
  button.textContent = 'Cancelling…';
  try {
    const data = await api('/api/free-agents', { action: 'withdraw', offer_id: offerId });
    if (message) message.textContent = data.message || `Offer to ${offer?.player_name || 'player'} withdrawn.`;
    if (offer?.transfermarkt_id) {
      document.querySelectorAll('[data-external-offer]').forEach((externalButton) => {
        if (String(externalButton.dataset.tmId || '') !== String(offer.transfermarkt_id)) return;
        externalButton.disabled = false;
        externalButton.textContent = 'Make offer';
      });
    }
    await refreshOffers();
  } catch (error) {
    if (message) message.textContent = error.message;
    button.disabled = false;
    button.textContent = 'Cancel offer';
    await refreshOffers();
  }
}

function observeOutgoingTransferRenders() {
  if (!transfersActive()) {
    outgoingObserver?.disconnect();
    outgoingObserver = null;
    observedOutgoing = null;
    return;
  }
  const outgoing = document.getElementById('outgoingTransferOffers');
  if (outgoing === observedOutgoing) return;
  outgoingObserver?.disconnect();
  outgoingObserver = null;
  observedOutgoing = outgoing;
  if (!outgoing) return;
  outgoingObserver = new MutationObserver(() => scheduleFreeAgentUi());
  outgoingObserver.observe(outgoing, { childList: true });
}

function scheduleFreeAgentUi({ refresh = false, delay = 0 } = {}) {
  setTimeout(() => {
    if (!transfersActive()) return;
    observeOutgoingTransferRenders();
    restyleFreeAgentUi();
    if (refresh) refreshOffers();
  }, delay);
}

document.addEventListener('click', (event) => {
  const withdrawButton = event.target.closest('[data-withdraw-open-market-offer]');
  if (withdrawButton) {
    event.preventDefault();
    event.stopImmediatePropagation();
    withdrawOpenMarketOffer(withdrawButton);
    return;
  }
  const button = event.target.closest('[data-sign-free-agent]');
  if (!button) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  submitOffer(button);
}, true);

document.addEventListener('click', (event) => {
  if (event.target.closest('[data-open-market-tab="free-agents"], [data-free-agent-browse], [data-free-agent-search-form] button')) {
    scheduleFreeAgentUi({ refresh: true, delay: 50 });
  }
});

document.addEventListener('tbg:external-offer-submitted', () => {
  scheduleFreeAgentUi({ refresh: true });
});

document.addEventListener('tbg:view-changed', (event) => {
  if (event.detail?.view === 'transfers') scheduleFreeAgentUi({ refresh: true });
  else observeOutgoingTransferRenders();
});

window.addEventListener('tbg:portal-rendered', () => {
  if (transfersActive()) scheduleFreeAgentUi({ refresh: true });
});

if (transfersActive()) {
  observeOutgoingTransferRenders();
  restyleFreeAgentUi();
  refreshOffers();
}
