const offerEscape = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const offerMoney = (value) => `£${Math.max(0, Number(value) || 0).toLocaleString('en-GB')}`;
let latestFreeAgentOffers = [];

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
  return reason.replaceAll('_', ' ');
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
  host.innerHTML = `<strong>Your free-agent offers</strong>${recent.length ? recent.map((offer) => `
    <div style="margin-top:.55rem">
      <strong>${offerEscape(offer.player_name || offer.player_id)}</strong>
      <small>${offerMoney(offer.wage)} / week · ${offerEscape(offer.contract_years)} season${Number(offer.contract_years) === 1 ? '' : 's'} · ${offerEscape(statusLabel(offer))}</small>
      ${offer.status !== 'pending' && offer.decision_reason ? `<small>${offerEscape(offerReason(offer))}</small>` : ''}
    </div>`).join('') : '<p class="open-market-empty">No free-agent offers submitted yet.</p>'}`;
}

function nativeOutgoingOfferCount(outgoing) {
  return outgoing
    ? outgoing.querySelectorAll(':scope > article.incoming-transfer-offer').length
    : 0;
}

function restoreOutgoingEmptyState(outgoing) {
  if (!outgoing || nativeOutgoingOfferCount(outgoing)) return;
  const hasEmptyState = Array.from(outgoing.children).some((child) => child.tagName === 'P' && (child.textContent || '').trim() === 'No active outgoing offers.');
  if (!hasEmptyState) {
    const empty = document.createElement('p');
    empty.textContent = 'No active outgoing offers.';
    outgoing.append(empty);
  }
}

function renderPendingOffersInTransferSummary(offers = []) {
  const pending = offers.filter((offer) => offer.status === 'pending');
  const outgoing = document.getElementById('outgoingTransferOffers');
  if (outgoing) {
    let host = outgoing.querySelector('[data-free-agent-outgoing-summary]');
    const emptyState = Array.from(outgoing.children).find((child) => child.tagName === 'P' && (child.textContent || '').trim() === 'No active outgoing offers.');
    if (!pending.length) {
      host?.remove();
      restoreOutgoingEmptyState(outgoing);
    } else {
      emptyState?.remove();
      if (!host) {
        host = document.createElement('div');
        host.dataset.freeAgentOutgoingSummary = 'true';
        outgoing.append(host);
      }
      const html = pending.map((offer) => `
        <div class="transfer-free-agent-pending" style="margin-top:.55rem">
          <strong>${offerEscape(offer.player_name || offer.player_id)}</strong>
          <small>Free agent · ${offerMoney(offer.wage)} / week · ${offerEscape(offer.contract_years)} season${Number(offer.contract_years) === 1 ? '' : 's'}</small>
          <small>Awaiting player decision · ${offerEscape(formatDecision(offer.decision_at))}</small>
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
  document.querySelectorAll('[data-sign-free-agent]').forEach((button) => {
    if (button.textContent !== 'Make offer') button.textContent = 'Make offer';
    if (button.getAttribute('aria-label') !== 'Make contract offer') button.setAttribute('aria-label', 'Make contract offer');
  });
  const message = document.getElementById('openMarketMessage');
  if (message && /Signing is settled directly into the live world/i.test(message.textContent || '')) {
    message.textContent = 'Free agents can receive offers from several clubs. Submit contract terms and the player will choose after the six-hour offer window; unattractive offers can be rejected.';
  }
  renderPendingOffersInTransferSummary(latestFreeAgentOffers);
}

async function refreshOffers() {
  if (!document.getElementById('openMarketWorkspace')) return;
  try {
    const data = await api('/api/free-agents?q=__offer_status_only__&limit=1');
    const offers = Array.isArray(data.offers) ? data.offers : [];
    latestFreeAgentOffers = offers;
    renderOfferPanel(offers);
    renderPendingOffersInTransferSummary(offers);
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

document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-sign-free-agent]');
  if (!button) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  submitOffer(button);
}, true);

document.addEventListener('click', (event) => {
  if (event.target.closest('[data-open-market-tab="free-agents"], [data-free-agent-browse], [data-free-agent-search-form] button')) {
    setTimeout(() => { restyleFreeAgentUi(); refreshOffers(); }, 50);
  }
});

const observer = new MutationObserver(() => restyleFreeAgentUi());
observer.observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener('tbg:portal-rendered', () => setTimeout(() => { restyleFreeAgentUi(); refreshOffers(); }, 0));
restyleFreeAgentUi();
refreshOffers();
