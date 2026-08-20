const openMarketEscape = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const openMarketMoney = (value) => `£${Math.max(0, Number(value) || 0).toLocaleString('en-GB')}`;
const openMarketEur = (value) => `€${Math.max(0, Number(value) || 0).toLocaleString('en-GB')}`;

let openMarketMounted = false;
let openMarketTab = 'listed';
let openMarketListings = [];
let openMarketFreeAgents = [];
let openMarketLoading = false;

function openMarketToken() {
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

async function openMarketRequest(path, body = null) {
  const token = openMarketToken();
  if (!token) throw new Error('Sign in to use the transfer market.');
  const response = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || data.message || `Transfer market request failed (HTTP ${response.status})`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

function ensureOpenMarketStyles() {
  if (document.getElementById('tbgOpenMarketStyles')) return;
  const style = document.createElement('style');
  style.id = 'tbgOpenMarketStyles';
  style.textContent = `
    .open-market-shell{margin:1rem 0 1.25rem;border:1px solid var(--border,#d8d8d8);border-radius:14px;overflow:hidden;background:var(--panel,#fff)}
    .open-market-heading{display:flex;gap:1rem;align-items:flex-start;justify-content:space-between;padding:1rem 1rem .7rem}.open-market-heading h3{margin:0 0 .25rem}.open-market-heading p{margin:0;max-width:70ch}
    .open-market-tabs{display:flex;gap:.4rem;padding:0 1rem .8rem;overflow-x:auto}.open-market-tabs button{white-space:nowrap}.open-market-tabs button[aria-selected="true"]{font-weight:700;box-shadow:inset 0 -2px currentColor}
    .open-market-panel{padding:0 1rem 1rem}.open-market-toolbar{display:flex;gap:.6rem;flex-wrap:wrap;align-items:end;margin-bottom:.8rem}.open-market-toolbar label{min-width:220px;flex:1}.open-market-toolbar input{width:100%}
    .open-market-results{display:grid;gap:.65rem}.open-market-card{display:flex;gap:1rem;justify-content:space-between;align-items:center;padding:.8rem;border:1px solid var(--border,#dedede);border-radius:10px}.open-market-card>div:first-child{min-width:0}.open-market-card strong,.open-market-card span,.open-market-card small{display:block}.open-market-card small{opacity:.8;margin-top:.18rem}.open-market-actions{display:flex;gap:.45rem;align-items:end;flex-wrap:wrap;justify-content:flex-end}.open-market-actions label{font-size:.82rem;min-width:95px}.open-market-actions input,.open-market-actions select{display:block;max-width:120px}.open-market-empty{padding:.85rem 0;opacity:.8}.open-market-status{padding:.55rem .8rem;border-radius:999px;background:rgba(127,127,127,.12);white-space:nowrap}.open-market-external-note{padding:.8rem;border:1px dashed var(--border,#bbb);border-radius:10px}.open-market-badge{display:inline-block!important;padding:.1rem .4rem;border-radius:999px;background:rgba(127,127,127,.12);font-size:.78rem;margin-top:.3rem}.open-market-card button[disabled]{opacity:.55}
    @media(max-width:720px){.open-market-card{align-items:flex-start;flex-direction:column}.open-market-actions{justify-content:flex-start;width:100%}.open-market-heading{flex-direction:column}.open-market-status{white-space:normal}}
  `;
  document.head.append(style);
}

function openMarketHost() {
  return document.getElementById('transferNegotiationWorkspace');
}

function mountOpenMarket() {
  const workspace = openMarketHost();
  if (!workspace) {
    openMarketMounted = false;
    return false;
  }
  if (document.getElementById('openMarketWorkspace')) {
    openMarketMounted = true;
    return true;
  }
  ensureOpenMarketStyles();
  const grid = workspace.querySelector('.transfer-negotiation-grid');
  if (!grid) return false;
  const shell = document.createElement('section');
  shell.id = 'openMarketWorkspace';
  shell.className = 'open-market-shell';
  shell.innerHTML = `
    <div class="open-market-heading">
      <div><h3>Open market</h3><p>Discover players in one place: club listings, unowned TBG/TPF free agents and Transfermarkt-ID lookup.</p></div>
      <span id="openMarketStatus" class="open-market-status">Ready</span>
    </div>
    <div class="open-market-tabs" role="tablist" aria-label="Open transfer market">
      <button type="button" role="tab" data-open-market-tab="listed" aria-selected="true">Listed players</button>
      <button type="button" role="tab" data-open-market-tab="free-agents" aria-selected="false">Free agents</button>
      <button type="button" role="tab" data-open-market-tab="external" aria-selected="false">External search</button>
    </div>
    <div id="openMarketPanel" class="open-market-panel"></div>`;
  grid.before(shell);
  shell.addEventListener('click', handleOpenMarketClick);
  shell.addEventListener('submit', handleOpenMarketSubmit);
  openMarketMounted = true;
  renderOpenMarket();
  refreshListings().catch(showOpenMarketError);
  return true;
}

function setOpenMarketStatus(text) {
  const host = document.getElementById('openMarketStatus');
  if (host) host.textContent = text;
}

function showOpenMarketError(error) {
  setOpenMarketStatus('Unavailable');
  const message = document.getElementById('openMarketMessage');
  if (message) message.textContent = error.message;
}

function listingCard(listing) {
  const mine = Boolean(listing.is_own_listing);
  return `<article class="open-market-card">
    <div>
      <strong>${openMarketEscape(listing.player_name || listing.player_id)}</strong>
      <span>${openMarketEscape(listing.club_name || listing.seller_club_name || listing.club_id || listing.seller_club_id || 'Club')} · ${openMarketMoney(listing.asking_fee || 0)}</span>
      <small>${openMarketEscape(listing.position || '')}${listing.rating ? ` · Rating ${openMarketEscape(listing.rating)}` : ''}</small>
      ${mine ? '<small class="open-market-badge">Your listing</small>' : ''}
    </div>
    <div class="open-market-actions">
      ${mine ? '<span class="open-market-status">Already listed</span>' : `<button type="button" data-open-market-prepare-offer data-player-id="${openMarketEscape(listing.player_id)}" data-club-id="${openMarketEscape(listing.club_id || listing.seller_club_id || '')}" data-fee="${openMarketEscape(listing.asking_fee || 0)}">Prepare offer</button>`}
    </div>
  </article>`;
}

function freeAgentCard(player) {
  const id = openMarketEscape(player.tbg_player_id);
  return `<article class="open-market-card" data-free-agent-card="${id}">
    <div>
      <strong>${openMarketEscape(player.display_name || player.tbg_player_id)}</strong>
      <span>${openMarketEscape(player.position || player.position_group || 'Player')}${player.age != null ? ` · Age ${openMarketEscape(player.age)}` : ''}${player.tbg_rating != null ? ` · Rating ${openMarketEscape(player.tbg_rating)}` : ''}</span>
      <small>${Array.isArray(player.nationality) ? openMarketEscape(player.nationality.join(', ')) : openMarketEscape(player.nationality || '')}${player.market_value_eur != null ? ` · TM value ${openMarketEur(player.market_value_eur)}` : ''}</small>
      <small>TM ID ${openMarketEscape(player.transfermarkt_id || '—')} · canonical ${id}</small>
    </div>
    <div class="open-market-actions">
      <label>Contract<select data-free-agent-years>${[1,2,3,4,5].map((years) => `<option value="${years}"${years === 3 ? ' selected' : ''}>${years} season${years === 1 ? '' : 's'}</option>`).join('')}</select></label>
      <label>Wage<input type="number" min="0" step="100" value="1000" data-free-agent-wage></label>
      <button type="button" class="primary-action" data-sign-free-agent="${id}" data-tm-id="${openMarketEscape(player.transfermarkt_id || '')}">Sign</button>
    </div>
  </article>`;
}

function renderOpenMarket() {
  const panel = document.getElementById('openMarketPanel');
  if (!panel) return;
  document.querySelectorAll('[data-open-market-tab]').forEach((button) => {
    button.setAttribute('aria-selected', String(button.dataset.openMarketTab === openMarketTab));
  });

  if (openMarketTab === 'listed') {
    panel.innerHTML = `<div class="open-market-toolbar"><div><strong>Club listings</strong><div><small>Use a listing to prefill the existing first-class offer composer.</small></div></div><button type="button" data-refresh-listings>Refresh</button></div><p id="openMarketMessage" aria-live="polite"></p><div class="open-market-results">${openMarketListings.length ? openMarketListings.map(listingCard).join('') : '<p class="open-market-empty">No active transfer listings found.</p>'}</div>`;
    return;
  }

  if (openMarketTab === 'free-agents') {
    panel.innerHTML = `<form class="open-market-toolbar" data-free-agent-search-form><label>Search unowned TBG/TPF players<input id="freeAgentSearchQuery" type="search" placeholder="Name, position, nationality or former club"></label><button type="submit">Search</button><button type="button" data-free-agent-browse>Browse</button></form><p id="openMarketMessage" aria-live="polite">Free agents already have a canonical TBG identity. Signing is settled directly into the live world.</p><div class="open-market-results">${openMarketFreeAgents.length ? openMarketFreeAgents.map(freeAgentCard).join('') : '<p class="open-market-empty">Search or browse the governed free-agent pool.</p>'}</div>`;
    return;
  }

  panel.innerHTML = `<form class="open-market-toolbar" data-external-search-form><label>Transfermarkt ID<input id="externalTmId" inputmode="numeric" autocomplete="off" placeholder="e.g. 342229"></label><button type="submit">Find player</button></form><p id="openMarketMessage" aria-live="polite">External search first checks whether this TM ID already belongs to an unowned canonical TBG/TPF player. Importing a genuinely new external player is the next Slice D step.</p><div id="externalSearchResult" class="open-market-results"></div>`;
}

async function refreshListings() {
  setOpenMarketStatus('Loading listings…');
  const data = await openMarketRequest('/api/transfer-deals');
  openMarketListings = Array.isArray(data.listings) ? data.listings : [];
  setOpenMarketStatus(`${openMarketListings.length} listed`);
  if (openMarketTab === 'listed') renderOpenMarket();
}

async function searchFreeAgents(query = '') {
  if (openMarketLoading) return;
  openMarketLoading = true;
  setOpenMarketStatus('Searching…');
  try {
    const suffix = query ? `?q=${encodeURIComponent(query)}&limit=30` : '?limit=30';
    const data = await openMarketRequest(`/api/free-agents${suffix}`);
    openMarketFreeAgents = Array.isArray(data.players) ? data.players : [];
    setOpenMarketStatus(`${openMarketFreeAgents.length} free agents`);
    renderOpenMarket();
  } finally {
    openMarketLoading = false;
  }
}

function prepareListedOffer(button) {
  const action = document.getElementById('negotiationAction');
  const club = document.getElementById('negotiationClub');
  const player = document.getElementById('negotiationPlayer');
  const fee = document.getElementById('negotiationFee');
  if (!action || !club || !player || !fee) throw new Error('The first-class offer composer is not ready yet.');
  action.value = 'offer';
  action.dispatchEvent(new Event('change', { bubbles: true }));
  club.value = button.dataset.clubId || '';
  club.dispatchEvent(new Event('change', { bubbles: true }));
  player.value = button.dataset.playerId || '';
  fee.value = openMarketMoney(button.dataset.fee || 0);
  document.querySelector('.transfer-negotiation-compose')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  setOpenMarketStatus('Offer prepared');
}

async function signFreeAgent(button) {
  const card = button.closest('[data-free-agent-card]');
  const years = Number(card?.querySelector('[data-free-agent-years]')?.value || 3);
  const wageInput = card?.querySelector('[data-free-agent-wage]');
  const wage = Number.isFinite(Number(wageInput?.value)) ? Math.max(0, Math.round(Number(wageInput.value))) : 1000;
  button.disabled = true;
  setOpenMarketStatus('Signing…');
  const message = document.getElementById('openMarketMessage');
  try {
    const data = await openMarketRequest('/api/free-agents', {
      action: 'sign',
      player_id: button.dataset.signFreeAgent,
      transfermarkt_id: button.dataset.tmId || undefined,
      contract_years: years,
      wage,
      client_request_id: window.crypto?.randomUUID ? window.crypto.randomUUID() : `${Date.now()}-${button.dataset.signFreeAgent}`
    });
    if (message) message.textContent = data.message || 'Free agent signed successfully.';
    setOpenMarketStatus('Signed');
    openMarketFreeAgents = openMarketFreeAgents.filter((player) => player.tbg_player_id !== button.dataset.signFreeAgent);
    renderOpenMarket();
    document.dispatchEvent(new CustomEvent('tbg:transfer-history-refresh'));
  } catch (error) {
    if (message) message.textContent = error.message;
    setOpenMarketStatus('Signing failed');
    button.disabled = false;
  }
}

async function externalLookup() {
  const tmId = String(document.getElementById('externalTmId')?.value || '').trim();
  const resultHost = document.getElementById('externalSearchResult');
  const message = document.getElementById('openMarketMessage');
  if (!/^\d+$/.test(tmId)) {
    if (message) message.textContent = 'Enter a numeric Transfermarkt ID.';
    return;
  }
  setOpenMarketStatus('Looking up…');
  try {
    const data = await openMarketRequest(`/api/free-agents?tm_id=${encodeURIComponent(tmId)}&limit=1`);
    const player = data.players?.[0];
    if (!player) throw new Error('No matching player returned.');
    openMarketFreeAgents = [player];
    if (resultHost) resultHost.innerHTML = `${freeAgentCard(player)}<div class="open-market-external-note">This TM ID already maps to an unowned canonical TBG/TPF player, so no external import is needed. You can sign the player directly.</div>`;
    setOpenMarketStatus('Canonical player found');
  } catch (error) {
    if (error.status === 404 && error.data?.external_import_required) {
      if (resultHost) resultHost.innerHTML = `<div class="open-market-external-note"><strong>External player</strong><p>TM ID ${openMarketEscape(tmId)} is not in the current governed free-agent pool. The next Slice D step will resolve/import this identity from Transfermarkt before acquisition.</p></div>`;
      if (message) message.textContent = 'No existing TBG/TPF identity found. External import is required.';
      setOpenMarketStatus('Import required');
      return;
    }
    if (message) message.textContent = error.message;
    setOpenMarketStatus('Lookup failed');
  }
}

function handleOpenMarketClick(event) {
  const tab = event.target.closest('[data-open-market-tab]');
  if (tab) {
    openMarketTab = tab.dataset.openMarketTab;
    renderOpenMarket();
    if (openMarketTab === 'listed') refreshListings().catch(showOpenMarketError);
    return;
  }
  const refresh = event.target.closest('[data-refresh-listings]');
  if (refresh) { refreshListings().catch(showOpenMarketError); return; }
  const browse = event.target.closest('[data-free-agent-browse]');
  if (browse) { searchFreeAgents('').catch(showOpenMarketError); return; }
  const prepare = event.target.closest('[data-open-market-prepare-offer]');
  if (prepare) { try { prepareListedOffer(prepare); } catch (error) { showOpenMarketError(error); } return; }
  const sign = event.target.closest('[data-sign-free-agent]');
  if (sign) { signFreeAgent(sign); }
}

function handleOpenMarketSubmit(event) {
  if (event.target.matches('[data-free-agent-search-form]')) {
    event.preventDefault();
    searchFreeAgents(String(document.getElementById('freeAgentSearchQuery')?.value || '').trim()).catch(showOpenMarketError);
    return;
  }
  if (event.target.matches('[data-external-search-form]')) {
    event.preventDefault();
    externalLookup();
  }
}

function scheduleOpenMarketMount({ refreshListed = false } = {}) {
  setTimeout(() => {
    const mounted = mountOpenMarket();
    if (mounted && refreshListed && openMarketTab === 'listed') refreshListings().catch(showOpenMarketError);
  }, 0);
}

window.addEventListener('tbg:portal-rendered', () => scheduleOpenMarketMount());

document.addEventListener('tbg:view-changed', (event) => {
  if (event.detail?.view !== 'transfers') return;
  scheduleOpenMarketMount({ refreshListed: true });
});

mountOpenMarket();
