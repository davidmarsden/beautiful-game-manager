import { openClubInspection } from './club-inspection.js';
import { requestedTbgClubId } from './stable-club-route.js';

const PENDING_CLUB_KEY = 'tbg_pending_club_id';

function rememberRequestedClub(clubId) {
  if (!clubId) return;
  localStorage.setItem(PENDING_CLUB_KEY, clubId);
}

function pendingClubId() {
  const stored = localStorage.getItem(PENDING_CLUB_KEY) || '';
  return requestedTbgClubId(globalThis.location?.href || '')
    || requestedTbgClubId(`/?club=${encodeURIComponent(stored)}`);
}

function clearClubRequest() {
  localStorage.removeItem(PENDING_CLUB_KEY);
  const url = new URL(window.location.href);
  url.searchParams.delete('club');
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
}

function portalIsReady() {
  const portal = document.getElementById('clubPortal');
  return Boolean(portal && !portal.hidden);
}

export function activateRequestedClubLink(clubId = pendingClubId()) {
  if (!clubId || typeof document === 'undefined') return;
  rememberRequestedClub(clubId);
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

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const requested = requestedTbgClubId(globalThis.location?.href || '');
  rememberRequestedClub(requested);
  document.addEventListener('submit', (event) => {
    if (event.target?.id === 'loginForm') rememberRequestedClub(requested || pendingClubId());
  }, true);
  activateRequestedClubLink(requested || pendingClubId());
}
