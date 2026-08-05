import { openTbgPlayerProfile } from './player-profile.js';

let historyDirectory = null;
let loading = null;
let portalSnapshot = null;

function storedAccessToken() {
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

function portalDirectory() {
  const squad = portalSnapshot?.squad;
  const clubId = portalSnapshot?.appointment?.club_id || portalSnapshot?.club?.club_id;
  if (!Array.isArray(squad) || !clubId) return null;
  return {
    clubs: {
      [clubId]: {
        ...(portalSnapshot.club || {}),
        club_id: clubId,
        players: squad
      }
    }
  };
}

async function historyDirectoryData() {
  if (historyDirectory) return historyDirectory;
  if (loading) return loading;
  loading = (async () => {
    const token = storedAccessToken();
    if (!token) throw new Error('Sign in to open the TBG player profile.');
    const response = await fetch('/api/history', { headers: { authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error('Could not load the canonical player directory.');
    historyDirectory = await response.json();
    return historyDirectory;
  })().finally(() => { loading = null; });
  return loading;
}

function findPlayer(data, trigger) {
  const href = trigger instanceof HTMLAnchorElement ? trigger.href : '';
  const playerId = String(trigger.dataset.tbgPlayerId || trigger.dataset.playerId || '').trim();
  const label = trigger.textContent.trim();
  for (const club of Object.values(data?.clubs || {})) {
    const player = (club.players || []).find((candidate) =>
      (playerId && (candidate.tbg_player_id === playerId || candidate.player_id === playerId))
      || (href && (candidate.profile_url === href || candidate.pink_final_profile_url === href))
      || candidate.display_name === label
    );
    if (player) return { player, club };
  }
  return null;
}

async function resolvePlayer(trigger) {
  const localMatch = findPlayer(portalDirectory(), trigger);
  if (localMatch) return localMatch;
  return findPlayer(await historyDirectoryData(), trigger);
}

function profileRoot(trigger) {
  return trigger.closest('.history-club-host, #historyContent, #squadView, #clubPortal') || document.querySelector('#clubPortal') || document.body;
}

function followAnchor(trigger) {
  if (!(trigger instanceof HTMLAnchorElement) || !trigger.href) return;
  if (trigger.target === '_blank') window.open(trigger.href, '_blank', 'noopener');
  else window.location.assign(trigger.href);
}

window.addEventListener('tbg:portal-rendered', (event) => {
  portalSnapshot = event.detail || null;
});

document.addEventListener('click', async (event) => {
  const trigger = event.target.closest('.player-link');
  if (!trigger || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  try {
    const match = await resolvePlayer(trigger);
    if (!match) throw new Error('This player is not present in the current canonical world.');
    openTbgPlayerProfile(profileRoot(trigger), match.player, match.club);
  } catch (error) {
    console.error('Could not open TBG player profile', error);
    followAnchor(trigger);
  }
}, true);
