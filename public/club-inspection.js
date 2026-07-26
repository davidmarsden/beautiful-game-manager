import { mountReadOnlySquadView } from './squad-view.js';

let directoryPromise = null;

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

async function clubDirectory() {
  if (!directoryPromise) {
    directoryPromise = (async () => {
      const token = storedAccessToken();
      if (!token) throw new Error('Authentication required');
      const response = await fetch('/api/history', { headers: { authorization: `Bearer ${token}` } });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Could not load club squads');
      return body.clubs || {};
    })().catch((error) => { directoryPromise = null; throw error; });
  }
  return directoryPromise;
}

function inspectionHost() {
  let host = document.getElementById('portalClubInspectionHost');
  if (host) return host;
  host = document.createElement('div');
  host.id = 'portalClubInspectionHost';
  host.className = 'history-club-host portal-club-inspection-host';
  const workspace = document.querySelector('.workspace');
  workspace?.prepend(host);
  return host;
}

export async function openClubInspection(clubId) {
  if (!clubId) return;
  const clubs = await clubDirectory();
  const club = clubs[clubId];
  if (!club) return;
  const host = inspectionHost();
  mountReadOnlySquadView(host, club);
  const panel = host.querySelector('#historyClubPanel');
  panel?.querySelector('[data-close-club]')?.addEventListener('click', () => host.remove());
  panel?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

document.addEventListener('click', (event) => {
  const link = event.target.closest('[data-club-id]');
  if (!link || link.closest('#historyView')) return;
  event.preventDefault();
  event.stopPropagation();
  openClubInspection(link.dataset.clubId).catch((error) => console.error('Could not open club inspection', error));
});
