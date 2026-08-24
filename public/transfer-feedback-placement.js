const MESSAGE_ID = 'transferNegotiationMessage';
const STYLE_ID = 'transferFeedbackPlacementStyles';

let placementObserver = null;

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #${MESSAGE_ID}.transfer-feedback-banner {
      margin: 0 0 1rem;
      padding: .8rem 1rem;
      border: 1px solid currentColor;
      border-radius: .55rem;
      font-weight: 700;
    }
    #${MESSAGE_ID}.transfer-feedback-banner:empty {
      display: none;
    }
  `;
  document.head.append(style);
}

function placeTransferFeedback() {
  const workspace = document.getElementById('transferNegotiationWorkspace');
  const message = workspace?.querySelector(`#${MESSAGE_ID}`);
  const heading = workspace?.querySelector('.world-control-heading');
  const grid = workspace?.querySelector('.transfer-negotiation-grid');
  if (!workspace || !message || !heading || !grid) return false;

  ensureStyles();
  message.classList.add('transfer-feedback-banner');
  message.setAttribute('role', 'status');
  message.setAttribute('aria-live', 'polite');

  // Keep action feedback immediately below the Transfers heading, before the
  // potentially very tall proposal / offer grid. This prevents policy blocks
  // and validation errors being rendered below the fold.
  if (message.previousElementSibling !== heading) heading.after(message);
  return true;
}

function stopPlacementObserver() {
  placementObserver?.disconnect();
  placementObserver = null;
}

function armPlacementObserver() {
  if (placementObserver) return;
  const root = document.getElementById('transfersView') || document.body;
  if (!root) return;

  placementObserver = new MutationObserver(() => {
    if (placeTransferFeedback()) stopPlacementObserver();
  });
  placementObserver.observe(root, { childList: true, subtree: true });
}

function schedulePlacement() {
  queueMicrotask(() => {
    if (placeTransferFeedback()) {
      stopPlacementObserver();
      return;
    }
    // During a portal remount the transfer workspace may not exist yet. Observe
    // only the Transfers view/body long enough to catch that mount, then detach.
    armPlacementObserver();
  });
}

window.addEventListener('tbg:portal-rendered', schedulePlacement);
document.addEventListener('tbg:view-changed', (event) => {
  if (event.detail?.view === 'transfers') schedulePlacement();
});

schedulePlacement();
