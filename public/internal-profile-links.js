import { openTbgPlayerProfile } from './player-profile.js';

let historyDirectory = null;
let loading = null;

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

async function directory() {
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
  for (const club of Object.values(data.clubs || {})) {
    const player = (club.players || []).find((candidate) =>
      (playerId && (candidate.tbg_player_id === playerId || candidate.player_id === playerId))
      || (href && (candidate.profile_url === href || candidate.pink_final_profile_url === href))
      || candidate.display_name === label
    );
    if (player) return { player, club };
  }
  return null;
}

function profileRoot(trigger) {
  return trigger.closest('.history-club-host, #historyContent, #squadView, #clubPortal') || document.querySelector('#clubPortal') || document.body;
}

document.addEventListener('click', async (event) => {
  const trigger = event.target.closest('.player-link');
  if (!trigger) return;
  event.preventDefault();
  try {
    const match = findPlayer(await directory(), trigger);
    if (!match) throw new Error('This player is not present in the current canonical world.');
    openTbgPlayerProfile(profileRoot(trigger), match.player, match.club);
  } catch (error) {
    console.error('Could not open TBG player profile', error);
  }
}, true);
