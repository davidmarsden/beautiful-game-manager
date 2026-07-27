import { openClubInspection } from './club-inspection.js';
import { requestedTbgClubId } from './stable-club-route.js';

function clearClubRequest() {
  const url = new URL(window.location.href);
  url.searchParams.delete('club');
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
}

function portalIsReady() {
  const portal = document.getElementById('clubPortal');
  return Boolean(portal && !portal.hidden);
}

export function activateRequestedClubLink(clubId = requestedTbgClubId(globalThis.location?.href || '')) {
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
