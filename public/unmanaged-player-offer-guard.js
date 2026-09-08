let portalClubId = '';
let directoryPromise = null;

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

async function requestJson(path) {
  const token = accessToken();
  if (!token) throw new Error('Sign in again to check transfer availability.');
  const response = await fetch(path, { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Could not check transfer availability.');
  return data;
}

async function managerDirectory() {
  if (!directoryPromise) {
    directoryPromise = requestJson('/api/manager-participation').catch((error) => {
      directoryPromise = null;
      throw error;
    });
  }
  return directoryPromise;
}

function managerForClub(directory, clubId) {
  return (Array.isArray(directory?.directory) ? directory.directory : [])
    .find((manager) => String(manager.club_id || '') === String(clubId || '')) || null;
}

async function playerResult(playerId) {
  const data = await requestJson(`/api/global-search?q=${encodeURIComponent(playerId)}`);
  return (data.results || []).find((result) => result.type === 'player' && result.id === playerId) || null;
}

function ensureNote(actions, text) {
  let note = actions.querySelector('[data-unmanaged-offer-note]');
  if (!note) {
    note = document.createElement('div');
    note.dataset.unmanagedOfferNote = '';
    note.className = 'tbg-player-action-note';
    actions.append(note);
  }
  note.textContent = text;
}

async function classifyOfferButton(host) {
  const section = host?.querySelector('.tbg-player-profile[data-player-id]');
  const button = host?.querySelector('[data-player-make-offer]');
  const actions = host?.querySelector('[data-tbg-player-game-actions]');
  const playerId = String(section?.dataset.playerId || '').trim();
  if (!host || !button || !actions || !playerId || button.dataset.offerAvailabilityChecked === 'true') return;

  if (button.textContent.trim() === 'Your player') {
    button.dataset.offerAvailabilityChecked = 'true';
    return;
  }

  button.disabled = true;
  const originalText = button.textContent;
  button.textContent = 'Checking availability…';

  try {
    const result = await playerResult(playerId);
    if (!result || !host.isConnected) return;
    const clubId = String(result.club?.club_id || result.player?.club_id || '').trim();

    if (!clubId) {
      button.disabled = false;
      button.textContent = originalText === 'Checking availability…' ? 'Offer contract' : originalText;
      button.dataset.offerAvailabilityChecked = 'true';
      return;
    }

    if (portalClubId && clubId === portalClubId) {
      button.disabled = true;
      button.textContent = 'Your player';
      button.dataset.offerAvailabilityChecked = 'true';
      return;
    }

    const directory = await managerDirectory();
    if (!host.isConnected) return;
    const manager = managerForClub(directory, clubId);
    if (manager?.manager_id) {
      button.disabled = false;
      button.textContent = 'Make offer';
      button.dataset.offerAvailabilityChecked = 'true';
      return;
    }

    button.disabled = true;
    button.textContent = 'Unmanaged club';
    button.dataset.offerAvailabilityChecked = 'true';
    ensureNote(actions, 'This club has no active human manager, so direct transfer offers are not available. You can still shortlist the player.');
  } catch (error) {
    if (!host.isConnected) return;
    button.disabled = true;
    button.textContent = 'Offer unavailable';
    ensureNote(actions, error.message || 'Transfer availability could not be checked.');
  }
}

function inspectProfiles() {
  const host = document.querySelector('[data-tbg-player-profile-host]');
  if (!host) return;
  classifyOfferButton(host).catch((error) => console.error('Could not classify player offer availability', error));
}

window.addEventListener('tbg:portal-rendered', (event) => {
  portalClubId = String(event.detail?.appointment?.club_id || event.detail?.club?.club_id || '').trim();
  directoryPromise = null;
});

new MutationObserver(inspectProfiles).observe(document.documentElement, { childList: true, subtree: true });
inspectProfiles();
