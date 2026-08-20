const externalEscape = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const externalMoney = (value) => `€${Math.max(0, Number(value) || 0).toLocaleString('en-GB')}`;
let lastExternalTmId = '';

function externalToken() {
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

async function externalRequest(path, body = null) {
  const token = externalToken();
  if (!token) throw new Error('Sign in to use external player search.');
  const response = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || data.message || `External market request failed (HTTP ${response.status})`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

function externalDecision(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' });
}

function setExternalStatus(value) {
  const status = document.getElementById('openMarketStatus');
  if (status) status.textContent = value;
}

function externalResultHost() {
  return document.getElementById('externalSearchResult');
}

function externalMessage() {
  return document.getElementById('openMarketMessage');
}

function renderReadyExternal(data) {
  const player = data.player;
  const host = externalResultHost();
  if (!host || !player) return;
  host.innerHTML = `<article class="open-market-card" data-external-player-card="${externalEscape(player.tbg_player_id)}">
    <div>
      <strong>${externalEscape(player.display_name || player.tbg_player_id)}</strong>
      <span>${externalEscape(player.position || player.position_group || 'Player')}${player.age != null ? ` · Age ${externalEscape(player.age)}` : ''} · Rating ${externalEscape(player.tbg_rating)}</span>
      <small>${Array.isArray(player.nationality) ? externalEscape(player.nationality.join(', ')) : externalEscape(player.nationality || '')}${player.real_world_club ? ` · ${externalEscape(player.real_world_club)}` : ''}</small>
      <small>TM ID ${externalEscape(player.transfermarkt_id)} · TM value ${externalMoney(player.market_value_eur)} · canonical ${externalEscape(player.tbg_player_id)}</small>
      <small class="open-market-badge">External acquisition · market fee ${externalMoney(data.acquisition_fee_eur || player.external_acquisition_fee_eur)}</small>
    </div>
    <div class="open-market-actions">
      <label>Contract<select data-external-years>${[1,2,3,4,5].map((years) => `<option value="${years}"${years === 3 ? ' selected' : ''}>${years} season${years === 1 ? '' : 's'}</option>`).join('')}</select></label>
      <label>Wage<input type="number" min="0" step="100" value="${Math.max(1000, Number(data.expected_wage) || 1000)}" data-external-wage></label>
      <button type="button" class="primary-action" data-external-offer data-tm-id="${externalEscape(player.transfermarkt_id)}">Make offer</button>
    </div>
  </article>`;
  const message = externalMessage();
  if (message) message.textContent = 'This player has a governed TBG identity/rating but is not owned in this world. The market fee is fixed from the current Transfermarkt value; the player still chooses between competing contract offers.';
  setExternalStatus('External player ready');
}

function externalPlayerUnavailable(player) {
  const lifecycle = String(player.lifecycle_status || '').toLowerCase();
  return player.active_circulation === false || ['inactive', 'retired'].includes(lifecycle) || /retired/i.test(String(player.status || ''));
}

function renderNameResults(data) {
  const host = externalResultHost();
  if (!host) return;
  const results = Array.isArray(data.results) ? data.results : [];
  if (!results.length) {
    host.innerHTML = '<div class="open-market-external-note"><strong>No governed player found</strong><p>Try another spelling, nickname, or use a Transfermarkt ID to import a genuinely new player.</p></div>';
    const message = externalMessage();
    if (message) message.textContent = `No governed TBG/TPF player matched “${data.query || ''}”.`;
    setExternalStatus('No matches');
    return;
  }
  host.innerHTML = results.map((player) => {
    const nations = Array.isArray(player.nationality) ? player.nationality.join(', ') : player.nationality || '';
    const aliases = Array.isArray(player.aliases) ? player.aliases.filter(Boolean).slice(0, 4) : [];
    const aliasLine = aliases.length ? `<small>Also known as: ${externalEscape(aliases.join(', '))}</small>` : '';
    const status = player.in_world
      ? '<span class="open-market-status">Already in TBG world</span>'
      : !player.governed_rating_available
        ? '<span class="open-market-status">Awaiting TBG rating</span>'
        : externalPlayerUnavailable(player)
          ? '<span class="open-market-status">Unavailable</span>'
          : `<button type="button" data-select-external-player data-tm-id="${externalEscape(player.transfermarkt_id)}">View player</button>`;
    return `<article class="open-market-card">
      <div>
        <strong>${externalEscape(player.display_name || player.tbg_player_id)}</strong>
        <span>${externalEscape(player.position || 'Player')}${player.age != null ? ` · Age ${externalEscape(player.age)}` : ''}${player.tbg_rating != null ? ` · Rating ${externalEscape(player.tbg_rating)}` : ''}</span>
        <small>${externalEscape(nations)}${player.real_world_club ? ` · ${externalEscape(player.real_world_club)}` : ''}</small>
        ${aliasLine}
        <small>TM ID ${externalEscape(player.transfermarkt_id)}${player.market_value_eur != null ? ` · TM value ${externalMoney(player.market_value_eur)}` : ''}</small>
      </div>
      <div class="open-market-actions">${status}</div>
    </article>`;
  }).join('');
  const message = externalMessage();
  if (message) message.textContent = `${results.length} governed player${results.length === 1 ? '' : 's'} matched “${data.query || ''}”. Choose the correct player to continue.`;
  setExternalStatus(`${results.length} match${results.length === 1 ? '' : 'es'}`);
}

function renderImportState(data) {
  const host = externalResultHost();
  if (!host) return;
  const status = data.status || data.import?.status || 'not_imported';
  if (status === 'not_imported') {
    host.innerHTML = `<div class="open-market-external-note"><strong>Not yet in the governed player universe</strong><p>TM ID ${externalEscape(data.transfermarkt_id)} needs a targeted Transfermarkt import before it can be acquired.</p><button type="button" class="primary-action" data-request-external-import data-tm-id="${externalEscape(data.transfermarkt_id)}">Import player</button></div>`;
    setExternalStatus('Import required');
    return;
  }
  if (status === 'scraping' || status === 'requested') {
    host.innerHTML = `<div class="open-market-external-note"><strong>Import in progress</strong><p>Targeted Transfermarkt lookup for TM ID ${externalEscape(data.transfermarkt_id)} is running.</p><button type="button" data-refresh-external-import data-tm-id="${externalEscape(data.transfermarkt_id)}">Refresh status</button></div>`;
    setExternalStatus('Importing…');
    return;
  }
  if (status === 'scraped') {
    const snapshot = data.import?.player_snapshot || {};
    host.innerHTML = `<div class="open-market-external-note"><strong>${externalEscape(snapshot.display_name || `TM ID ${data.transfermarkt_id}`)}</strong><p>Transfermarkt data has been imported${snapshot.real_world_club ? ` from ${externalEscape(snapshot.real_world_club)}` : ''}. It now needs the governed TBG rating pipeline to publish an Ability rating before an acquisition can be submitted.</p><button type="button" data-refresh-external-import data-tm-id="${externalEscape(data.transfermarkt_id)}">Check rating status</button></div>`;
    setExternalStatus('Awaiting TBG rating');
    return;
  }
  host.innerHTML = `<div class="open-market-external-note"><strong>Import failed</strong><p>${externalEscape(data.import?.error || data.message || 'The targeted import could not be completed.')}</p><button type="button" data-refresh-external-import data-tm-id="${externalEscape(data.transfermarkt_id)}">Try status again</button></div>`;
  setExternalStatus('Import failed');
}

async function lookupExternal(tmId) {
  lastExternalTmId = String(tmId || '').trim();
  if (!/^\d+$/.test(lastExternalTmId)) throw new Error('Enter a numeric Transfermarkt ID.');
  setExternalStatus('Looking up…');
  const data = await externalRequest(`/api/external-market?tm_id=${encodeURIComponent(lastExternalTmId)}`);
  if (data.status === 'ready' && data.player) renderReadyExternal(data);
  else renderImportState(data);
}

async function searchExternalName(query) {
  const value = String(query || '').trim();
  if (value.length < 2) throw new Error('Enter at least two characters of the player name.');
  setExternalStatus('Searching…');
  const data = await externalRequest(`/api/external-player-search?q=${encodeURIComponent(value)}&limit=12`);
  renderNameResults(data);
}

async function lookupExternalInput(value) {
  const query = String(value || '').trim();
  if (/^\d+$/.test(query)) return lookupExternal(query);
  return searchExternalName(query);
}

async function requestExternalImport(tmId) {
  setExternalStatus('Starting import…');
  const data = await externalRequest('/api/external-market', { action: 'request_import', transfermarkt_id: tmId });
  if (data.status === 'ready' && data.player) renderReadyExternal(data);
  else renderImportState({ ...data, transfermarkt_id: tmId });
}

function externalRequestId(tmId) {
  const key = `tbg-external-offer-request:${tmId}`;
  let value = sessionStorage.getItem(key);
  if (!value) {
    value = window.crypto?.randomUUID ? window.crypto.randomUUID() : `${Date.now()}-${tmId}`;
    sessionStorage.setItem(key, value);
  }
  return { key, value };
}

async function submitExternalOffer(button) {
  const card = button.closest('[data-external-player-card]');
  const tmId = String(button.dataset.tmId || '').trim();
  const years = Number(card?.querySelector('[data-external-years]')?.value || 3);
  const wage = Math.max(0, Math.round(Number(card?.querySelector('[data-external-wage]')?.value || 0)));
  const request = externalRequestId(tmId);
  button.disabled = true;
  button.textContent = 'Offering…';
  setExternalStatus('Submitting offer…');
  try {
    const data = await externalRequest('/api/external-market', {
      action: 'offer',
      transfermarkt_id: tmId,
      contract_years: years,
      wage,
      client_request_id: request.value
    });
    sessionStorage.removeItem(request.key);
    const message = externalMessage();
    if (message) message.textContent = `Offer submitted. The player can consider competing offers until ${externalDecision(data.decision_at)}. Market fee on acceptance: ${externalMoney(data.acquisition_fee_eur)}.`;
    button.textContent = 'Offer pending';
    setExternalStatus('Awaiting player decision');
    document.dispatchEvent(new CustomEvent('tbg:external-offer-submitted', { detail: data }));
  } catch (error) {
    const message = externalMessage();
    if (message) message.textContent = error.message;
    button.disabled = false;
    button.textContent = 'Make offer';
    setExternalStatus('Offer failed');
  }
}

function refreshExternalCopy() {
  const selected = document.querySelector('[data-open-market-tab="external"][aria-selected="true"]');
  const form = document.querySelector('[data-external-search-form]');
  const message = externalMessage();
  if (!selected || !form || !message) return;
  const input = document.getElementById('externalTmId');
  const label = input?.closest('label');
  if (label?.firstChild?.nodeType === Node.TEXT_NODE) label.firstChild.nodeValue = 'Player name, nickname or Transfermarkt ID';
  if (input) {
    input.inputMode = 'text';
    input.placeholder = 'e.g. Huguinho, Victor Hugo or 1364573';
  }
  if (/next Slice D step|first checks|Transfermarkt player ID|Search by player name/i.test(message.textContent || '')) {
    message.textContent = 'Search by player name or nickname, or enter a Transfermarkt ID. Aliases come from governed player data and Transfermarkt profile identity; a TM ID remains available for precise lookup and genuinely new-player import.';
  }
}

document.addEventListener('submit', (event) => {
  if (!event.target.matches?.('[data-external-search-form]')) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const query = String(document.getElementById('externalTmId')?.value || '').trim();
  lookupExternalInput(query).catch((error) => {
    const message = externalMessage();
    if (message) message.textContent = error.message;
    setExternalStatus('Lookup failed');
  });
}, true);

document.addEventListener('click', (event) => {
  const selectButton = event.target.closest?.('[data-select-external-player]');
  if (selectButton) {
    event.preventDefault();
    event.stopImmediatePropagation();
    const tmId = String(selectButton.dataset.tmId || '').trim();
    const input = document.getElementById('externalTmId');
    if (input) input.value = tmId;
    lookupExternal(tmId).catch((error) => {
      const message = externalMessage();
      if (message) message.textContent = error.message;
      setExternalStatus('Lookup failed');
    });
    return;
  }
  const importButton = event.target.closest?.('[data-request-external-import]');
  if (importButton) {
    event.preventDefault();
    event.stopImmediatePropagation();
    requestExternalImport(importButton.dataset.tmId).catch((error) => {
      const message = externalMessage();
      if (message) message.textContent = error.message;
      setExternalStatus('Import failed');
    });
    return;
  }
  const refreshButton = event.target.closest?.('[data-refresh-external-import]');
  if (refreshButton) {
    event.preventDefault();
    event.stopImmediatePropagation();
    lookupExternal(refreshButton.dataset.tmId).catch((error) => {
      const message = externalMessage();
      if (message) message.textContent = error.message;
    });
    return;
  }
  const offerButton = event.target.closest?.('[data-external-offer]');
  if (offerButton) {
    event.preventDefault();
    event.stopImmediatePropagation();
    submitExternalOffer(offerButton);
  }
}, true);

const externalObserver = new MutationObserver(() => refreshExternalCopy());
externalObserver.observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener('tbg:portal-rendered', () => setTimeout(refreshExternalCopy, 0));
refreshExternalCopy();
