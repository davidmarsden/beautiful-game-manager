const MESSAGE_ID = 'transferNegotiationMessage';
const STYLE_ID = 'transferFeedbackPlacementStyles';

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
  const message = document.getElementById(MESSAGE_ID);
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

function schedulePlacement() {
  queueMicrotask(() => placeTransferFeedback());
}

window.addEventListener('tbg:portal-rendered', schedulePlacement);
document.addEventListener('tbg:view-changed', (event) => {
  if (event.detail?.view === 'transfers') schedulePlacement();
});

const observer = new MutationObserver(() => {
  if (document.getElementById(MESSAGE_ID)) placeTransferFeedback();
});
observer.observe(document.documentElement, { childList: true, subtree: true });

schedulePlacement();
