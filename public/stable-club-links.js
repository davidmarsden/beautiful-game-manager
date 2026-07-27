import { openClubInspection } from './club-inspection.js';

const FORBIDDEN_SCOPE_KEYS = new Set([
  'world', 'world_id', 'appointment', 'appointment_id', 'manager', 'manager_id',
  'season', 'season_id', 'squad', 'squad_id'
]);
const SAFE_CLUB_ID = /^[A-Za-z0-9._:-]{1,160}$/;

export function requestedTbgClubId(value = globalThis.location?.href || '') {
  let url;
  try {
    url = new URL(value, 'https://manager.invalid/');
  } catch {
    return null;
  }
  if ([...url.searchParams.keys()].some((key) => FORBIDDEN_SCOPE_KEYS.has(key.toLowerCase()))) return null;
  const clubId = String(url.searchParams.get('club') || '').trim();
  return SAFE_CLUB_ID.test(clubId) ? clubId : null;
}

function clearClubRequest() {
  const url = new URL(window.location.href);
  url.searchParams.delete('club');
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
}

function portalIsReady() {
  const portal = document.getElementById('clubPortal');
  return Boolean(portal && !portal.hidden);
}

export function activateRequestedClubLink(clubId = requestedTbgClubId()) {
  if (!clubId || typeof document === 'undefined') return;
  let opening = false;
  const openWhenReady = () => {
    if (opening || !portalIsReady()) return;
    opening = true;
    openClubInspection(clubId)
      .then(() => clearClubRequest())
      .catch((error) => {
        opening = false;
        console.error('Could not open requested club inspection', error);
      });
  };

  openWhenReady();
  if (opening) return;
  const observer = new MutationObserver(() => {
    openWhenReady();
    if (opening) observer.disconnect();
  });
  observer.observe(document.documentElement, { attributes: true, childList: true, subtree: true });
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') activateRequestedClubLink();
