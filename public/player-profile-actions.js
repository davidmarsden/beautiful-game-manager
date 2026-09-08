let ownClubId = '';
let managerDirectoryPromise = null;
let shortlistCache = [];
let shortlistPromise = null;

function token() {
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key?.startsWith('sb-') || !key.endsWith('-auth-token')) continue;
    try {
      const stored = JSON.parse(localStorage.getItem(key));
      const value = stored?.access_token || stored?.currentSession?.access_token;
      if (value) return value;
    } catch {}
  }
  return '';
}

async function shortlistRequest(body = null) {
  const auth = token();
  if (!auth) throw new Error('Sign in again to use your shortlist.');
  const response = await fetch('/api/player-shortlist', {
    method: body ? 'POST' : 'GET',
    headers: { authorization: `Bearer ${auth}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store'
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Could not update your shortlist.');
  shortlistCache = Array.isArray(data.results) ? data.results : [];
  return shortlistCache;
}

export async function shortlistResults({ force = false } = {}) {
  if (!force && shortlistPromise) return shortlistPromise;
  shortlistPromise = shortlistRequest().catch((error) => {
    shortlistPromise = null;
    throw error;
  });
  return shortlistPromise;
}

function isShortlisted(id) {
  return shortlistCache.some((entry) => entry.id === id);
}

async function toggleShortlist(result) {
  const currentlyShortlisted = isShortlisted(result.id);
  const results = await shortlistRequest({ action: currentlyShortlisted ? 'remove' : 'add', player_id: result.id, result });
  shortlistPromise = Promise.resolve(results);
  document.dispatchEvent(new CustomEvent('tbg:shortlist-changed', { detail: { count: results.length } }));
  return !currentlyShortlisted;
}

function installStyles() {
  if (document.getElementById('tbgPlayerProfileActionStyles')) return;
  const style = document.createElement('style');
  style.id = 'tbgPlayerProfileActionStyles';
  style.textContent = `
    .tbg-player-actions-enhanced{display:grid!important;gap:8px!important;align-items:stretch!important}
    .tbg-player-game-actions{display:grid;gap:8px;width:100%}
    .tbg-player-game-actions button{width:100%;border:1px solid #627986;background:#203746;color:#eef6fa;padding:9px 10px;font-weight:800;text-align:left;cursor:pointer}
    .tbg-player-game-actions button:hover,.tbg-player-game-actions button:focus-visible{background:#2a4b60;border-color:#88a4b4}
    .tbg-player-game-actions button.primary{background:#24458e;border-color:#4268bd;color:#fff}
    .tbg-player-game-actions button.primary:hover,.tbg-player-game-actions button.primary:focus-visible{background:#2c55ad}
    .tbg-player-game-actions button[disabled]{opacity:.48;cursor:not-allowed}
    .tbg-player-action-note{font-size:11px;color:#91a5b1;line-height:1.35}
  `;
  document.head.append(style);
}

async function managerDirectory() {
  if (managerDirectoryPromise) return managerDirectoryPromise;
  managerDirectoryPromise = (async () => {
    const auth = token();
    if (!auth) throw new Error('Sign in again to contact another manager.');
    const response = await fetch('/api/manager-participation', {
      headers: { authorization: `Bearer ${auth}` }, cache: 'no-store'
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Could not load manager directory.');
    if (!ownClubId) ownClubId = String(data.club_id || data.club?.club_id || '').trim();
    return data;
  })().catch((error) => {
    managerDirectoryPromise = null;
    throw error;
  });
  return managerDirectoryPromise;
}

function managerForClub(data, clubId) {
  return (Array.isArray(data?.directory) ? data.directory : []).find((manager) => String(manager.club_id || '') === String(clubId || '')) || null;
}

function profileResult(player, club) {
  const id = String(player.tbg_player_id || player.player_id || '').trim();
  const name = player.display_name || player.player_name || player.canonical_name || id || 'Player';
  const clubName = club?.club_name || club?.canonical_name || player.club_name || 'Free agent';
  const position = player.specific_position || player.position || player.primary_position || player.position_group || 'Player';
  return {
    type: 'player', id, name,
    secondary: `${position} · ${clubName}`,
    player,
    club: club || {}
  };
}

function closeProfile(host) {
  host?.querySelector('[data-close-player]')?.click();
}

function openTransfersAndDispatch(host, eventName, detail) {
  closeProfile(host);
  document.querySelector('[data-view="transfers"]')?.click();
  window.setTimeout(() => document.dispatchEvent(new CustomEvent(eventName, { detail })), 50);
}

async function openManagerForClub(host, clubId) {
  const data = await managerDirectory();
  const manager = managerForClub(data, clubId);
  if (!manager?.manager_id) throw new Error('This club does not currently have a contactable human manager.');
  closeProfile(host);
  const module = await import('./manager-participation.js');
  await module.openManagerParticipation(manager.manager_id);
}

function showActionMessage(actionRoot, message) {
  let note = actionRoot.querySelector('.tbg-player-action-note');
  if (!note) {
    note = document.createElement('div');
    note.className = 'tbg-player-action-note';
    actionRoot.append(note);
  }
  note.textContent = message;
}

async function resolveProfile(playerId) {
  const auth = token();
  if (!auth) return null;
  const response = await fetch(`/api/global-search?q=${encodeURIComponent(playerId)}`, {
    headers: { authorization: `Bearer ${auth}` }, cache: 'no-store'
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return null;
  return (data.results || []).find((result) => result.type === 'player' && result.id === playerId) || null;
}

async function mountActions(host) {
  const section = host?.querySelector('.tbg-player-profile[data-player-id]');
  const id = String(section?.dataset.playerId || '').trim();
  if (!host || !section || !id || host.querySelector('[data-tbg-player-game-actions]') || host.dataset.tbgPlayerActionsMounting === 'true') return;
  host.dataset.tbgPlayerActionsMounting = 'true';
  try {
    const [result] = await Promise.all([resolveProfile(id), shortlistResults().catch(() => [])]);
    if (!result || !host.isConnected || host.querySelector('[data-tbg-player-game-actions]')) return;
    const { player, club = {} } = result;
    const clubId = String(club.club_id || player.club_id || '').trim();
    if (clubId && !ownClubId) await managerDirectory().catch(() => null);
    const ownPlayer = Boolean(clubId && ownClubId && clubId === ownClubId);
    const actionsHost = host.querySelector('.tbg-player-actions');
    if (!actionsHost) return;

    installStyles();
    actionsHost.classList.add('tbg-player-actions-enhanced');
    const gameActions = document.createElement('div');
    gameActions.className = 'tbg-player-game-actions';
    gameActions.dataset.tbgPlayerGameActions = '';
    const shortlisted = isShortlisted(id);
    gameActions.innerHTML = `
      <button type="button" data-player-shortlist>${shortlisted ? '★ Shortlisted' : '☆ Add to shortlist'}</button>
      <button type="button" class="primary" data-player-make-offer${ownPlayer ? ' disabled' : ''}>${ownPlayer ? 'Your player' : clubId ? 'Make offer' : 'Offer contract'}</button>
      ${clubId && !ownPlayer ? '<button type="button" data-player-contact-manager hidden>Contact manager</button>' : ''}
    `;
    actionsHost.append(gameActions);

    gameActions.querySelector('[data-player-shortlist]')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        const added = await toggleShortlist(profileResult(player, club));
        button.textContent = added ? '★ Shortlisted' : '☆ Add to shortlist';
        showActionMessage(gameActions, added ? 'Added to your private shortlist. It will follow your manager account across devices.' : 'Removed from your shortlist.');
      } catch (error) {
        showActionMessage(gameActions, error.message || 'Could not update your shortlist.');
      } finally {
        button.disabled = false;
      }
    });

    gameActions.querySelector('[data-player-make-offer]')?.addEventListener('click', () => {
      if (ownPlayer) return;
      if (clubId) {
        openTransfersAndDispatch(host, 'tbg:prepare-player-offer', {
          playerId: id,
          playerName: result.name,
          clubId,
          clubName: club.club_name || club.canonical_name || player.club_name || clubId
        });
      } else {
        openTransfersAndDispatch(host, 'tbg:prepare-free-agent-offer', {
          playerId: id,
          playerName: result.name
        });
      }
    });

    const contact = gameActions.querySelector('[data-player-contact-manager]');
    if (contact) {
      managerDirectory().then((data) => {
        if (!host.isConnected) return;
        const manager = managerForClub(data, clubId);
        if (manager?.manager_id) {
          contact.hidden = false;
          contact.textContent = `Contact ${manager.manager_name || 'manager'}`;
        }
      }).catch(() => {});
      contact.addEventListener('click', () => {
        contact.disabled = true;
        openManagerForClub(host, clubId).catch((error) => {
          contact.disabled = false;
          showActionMessage(gameActions, error.message);
        });
      });
    }
  } finally {
    delete host.dataset.tbgPlayerActionsMounting;
  }
}

function inspectProfiles() {
  const host = document.querySelector('[data-tbg-player-profile-host]');
  if (!host || host.querySelector('[data-tbg-player-game-actions]') || host.dataset.tbgPlayerActionsMounting === 'true') return;
  mountActions(host).catch((error) => console.error('Could not mount player profile actions', error));
}

function waitFor(selector, { attempts = 40, delay = 50 } = {}) {
  return new Promise((resolve, reject) => {
    let remaining = attempts;
    const check = () => {
      const element = document.querySelector(selector);
      if (element) return resolve(element);
      remaining -= 1;
      if (remaining <= 0) return reject(new Error('The transfer controls are still loading. Try again.'));
      window.setTimeout(check, delay);
    };
    check();
  });
}

function clearPartExchangeDraft() {
  for (let guard = 0; guard < 100; guard += 1) {
    const remove = document.querySelector('#offerPlayersSelected [data-remove-exchange-player]');
    if (!remove) return;
    remove.click();
  }
}

async function prepareDirectOffer(detail = {}) {
  await waitFor('.transfer-negotiation-compose');
  const action = document.getElementById('negotiationAction');
  const club = document.getElementById('negotiationClub');
  const receivePlayer = document.getElementById('receivePlayer');
  const addReceivePlayer = document.getElementById('addReceivePlayer');
  const offerCash = document.getElementById('offerCash');
  const submit = document.getElementById('submitNegotiation');
  const composer = document.querySelector('.transfer-negotiation-compose');
  if (!action || !club || !receivePlayer || !addReceivePlayer || !offerCash || !submit || !composer) throw new Error('The transfer offer composer is not ready yet.');

  action.value = 'offer';
  action.dispatchEvent(new Event('change', { bubbles: true }));
  const clubOption = [...club.options].find((option) => option.value === detail.clubId);
  if (!clubOption) throw new Error(`${detail.clubName || 'This club'} is not currently available for direct negotiation.`);
  club.value = detail.clubId;
  club.dispatchEvent(new Event('change', { bubbles: true }));
  clearPartExchangeDraft();
  const playerOption = [...receivePlayer.options].find((option) => option.value === detail.playerId);
  if (!playerOption) throw new Error(`${detail.playerName || 'This player'} is not available in the current transfer directory.`);
  receivePlayer.value = detail.playerId;
  addReceivePlayer.click();
  offerCash.value = '0';
  submit.textContent = 'Propose offer';
  composer.dataset.preparedPlayerId = detail.playerId;
  const heading = composer.querySelector('h3');
  if (heading) heading.textContent = `Make offer for ${detail.playerName || 'player'}`;
  document.querySelector('[data-transfer-section="my"]')?.click();
  composer.scrollIntoView({ behavior: 'smooth', block: 'center' });
  window.setTimeout(() => offerCash.focus({ preventScroll: true }), 0);
}

async function prepareFreeAgentOffer(detail = {}) {
  const tab = await waitFor('[data-open-market-tab="free-agents"]');
  tab.click();
  const input = await waitFor('#freeAgentSearchQuery');
  input.value = detail.playerName || detail.playerId || '';
  const form = input.closest('[data-free-agent-search-form]');
  form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  const id = String(detail.playerId || '');
  if (id && window.CSS?.escape) {
    await waitFor(`[data-free-agent-card="${CSS.escape(id)}"]`).catch(() => null);
    document.querySelector(`[data-free-agent-card="${CSS.escape(id)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

async function openExternalPlayer(detail = {}) {
  const tmId = String(detail.transfermarktId || '').trim();
  if (!tmId) return;
  const tab = await waitFor('[data-open-market-tab="external"]');
  tab.click();
  const input = await waitFor('#externalTmId');
  input.value = tmId;
  const form = input.closest('[data-external-search-form]');
  form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  document.getElementById('openMarketWorkspace')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

window.addEventListener('tbg:portal-rendered', (event) => {
  ownClubId = String(event.detail?.appointment?.club_id || event.detail?.club?.club_id || '').trim();
  managerDirectoryPromise = null;
  shortlistCache = [];
  shortlistPromise = null;
});

document.addEventListener('tbg:prepare-player-offer', (event) => {
  prepareDirectOffer(event.detail).catch((error) => console.error('Could not prepare player offer', error));
});
document.addEventListener('tbg:prepare-free-agent-offer', (event) => {
  prepareFreeAgentOffer(event.detail).catch((error) => console.error('Could not prepare free-agent offer', error));
});
document.addEventListener('tbg:open-external-player', (event) => {
  openExternalPlayer(event.detail).catch((error) => console.error('Could not open external player', error));
});
new MutationObserver(inspectProfiles).observe(document.documentElement, { childList: true, subtree: true });
inspectProfiles();
