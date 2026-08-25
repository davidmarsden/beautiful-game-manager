const MESSAGE_ID = 'transferNegotiationMessage';
const STYLE_ID = 'transferFeedbackPlacementStyles';
const LOCAL_FEEDBACK_ATTR = 'data-transfer-action-feedback';
const ACTION_FEEDBACK_WINDOW_MS = 5000;

let placementObserver = null;
let transferObserver = null;
let messageObserver = null;
let observedMessage = null;
let activeFeedbackTarget = null;
let listingActionInFlight = false;
let listingAwaitingRefresh = false;

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
    #${MESSAGE_ID}.transfer-feedback-banner:empty,
    #${MESSAGE_ID}.transfer-feedback-suppressed {
      display: none;
    }
    [${LOCAL_FEEDBACK_ATTR}] {
      margin: .7rem 0 0;
      padding: .65rem .8rem;
      border: 1px solid currentColor;
      border-radius: .5rem;
      font-weight: 700;
    }
    [${LOCAL_FEEDBACK_ATTR}]:empty {
      display: none;
    }
  `;
  document.head.append(style);
}

function transferWorkspace() {
  return document.getElementById('transferNegotiationWorkspace');
}

function transferMessage() {
  return transferWorkspace()?.querySelector(`#${MESSAGE_ID}`) || null;
}

function findDealCard(dealId) {
  if (!dealId) return null;
  return Array.from(transferWorkspace()?.querySelectorAll('[data-first-class-deal]') || [])
    .find((card) => card.dataset.firstClassDeal === dealId) || null;
}

function directChildContaining(container, control) {
  if (!container || !control || !container.contains(control)) return null;
  let node = control;
  while (node?.parentElement && node.parentElement !== container) node = node.parentElement;
  return node?.parentElement === container ? node : null;
}

function findControlHost(containerSelector, controlSelector) {
  const container = transferWorkspace()?.querySelector(containerSelector);
  const control = container?.querySelector(controlSelector);
  return directChildContaining(container, control);
}

function localFeedbackHost() {
  if (!activeFeedbackTarget) return null;
  if (activeFeedbackTarget.type === 'proposal') {
    return transferWorkspace()?.querySelector('.transfer-negotiation-compose') || null;
  }
  if (activeFeedbackTarget.type === 'deal') return findDealCard(activeFeedbackTarget.dealId);
  if (activeFeedbackTarget.type === 'listing') {
    const playerId = CSS.escape(activeFeedbackTarget.playerId || '');
    return findControlHost('#activeTransferListings', `[data-withdraw-listing][data-player-id="${playerId}"]`);
  }
  if (activeFeedbackTarget.type === 'legacy-incoming') {
    const proposalId = CSS.escape(activeFeedbackTarget.proposalId || '');
    return findControlHost('#incomingTransferOffers', `[data-legacy-transfer-response][data-proposal-id="${proposalId}"]`);
  }
  if (activeFeedbackTarget.type === 'legacy-outgoing') {
    const proposalId = CSS.escape(activeFeedbackTarget.proposalId || '');
    return findControlHost('#outgoingTransferOffers', `[data-withdraw-legacy-offer][data-proposal-id="${proposalId}"]`);
  }
  return null;
}

function ensureLocalFeedback(host) {
  if (!host) return null;
  let local = host.querySelector(`:scope > [${LOCAL_FEEDBACK_ATTR}]`);
  if (!local) {
    local = document.createElement('p');
    local.setAttribute(LOCAL_FEEDBACK_ATTR, '');
    // The canonical page-level message remains the single live region. This
    // mirror is deliberately visual-only to avoid duplicate announcements.
    local.setAttribute('aria-hidden', 'true');

    if (activeFeedbackTarget?.type === 'proposal') {
      const submit = host.querySelector('#submitNegotiation');
      if (submit) submit.after(local);
      else host.append(local);
    } else {
      const actions = host.querySelector('.world-control-actions');
      if (actions) actions.after(local);
      else host.append(local);
    }
  }
  return local;
}

function setListingControlsDisabled(disabled) {
  transferWorkspace()?.querySelectorAll('[data-withdraw-listing]').forEach((button) => {
    button.disabled = disabled;
  });
}

function releaseListingActionLock() {
  listingActionInFlight = false;
  listingAwaitingRefresh = false;
  setListingControlsDisabled(false);
}

function syncGlobalFeedbackVisibility(localShown) {
  const message = transferMessage();
  if (!message) return;
  message.classList.toggle('transfer-feedback-suppressed', Boolean(localShown));
}

function targetMatchesCurrentAction(text) {
  if (!activeFeedbackTarget) return false;
  if (Date.now() - activeFeedbackTarget.capturedAt > ACTION_FEEDBACK_WINDOW_MS) return false;
  if (!activeFeedbackTarget.confirmed) {
    if (text === activeFeedbackTarget.baselineText) return false;
    activeFeedbackTarget.confirmed = true;
  }
  return true;
}

function mirrorFeedbackLocally() {
  const message = transferMessage();
  const text = String(message?.textContent || '').trim();
  if (!text || !targetMatchesCurrentAction(text)) {
    syncGlobalFeedbackVisibility(false);
    return false;
  }
  const host = localFeedbackHost();
  if (!host) {
    syncGlobalFeedbackVisibility(false);
    return false;
  }
  ensureStyles();
  const local = ensureLocalFeedback(host);
  if (!local) {
    syncGlobalFeedbackVisibility(false);
    return false;
  }
  if (local.textContent !== text) local.textContent = text;
  syncGlobalFeedbackVisibility(true);
  return true;
}

function handleMessageChange() {
  mirrorFeedbackLocally();
  if (!listingActionInFlight || activeFeedbackTarget?.type !== 'listing') return;
  const text = String(transferMessage()?.textContent || '').trim();
  if (!text || text === 'Withdrawing transfer listing…') return;
  if (text === 'Transfer listing withdrawn immediately.') {
    // Keep every listing control disabled until the successful refresh mutates
    // the listings DOM. Otherwise another withdrawal can start while the first
    // request is still finishing and steal the singleton action-local target.
    listingAwaitingRefresh = true;
    return;
  }
  // Errors do not refresh the listing DOM, so release immediately once the
  // request has produced its terminal error message.
  releaseListingActionLock();
}

function bindMessageObserver() {
  const message = transferMessage();
  if (!message || observedMessage === message) return;
  messageObserver?.disconnect();
  observedMessage = message;
  messageObserver = new MutationObserver(handleMessageChange);
  messageObserver.observe(message, { childList: true, characterData: true, subtree: true });
}

function placeTransferFeedback() {
  const workspace = transferWorkspace();
  const message = workspace?.querySelector(`#${MESSAGE_ID}`);
  const heading = workspace?.querySelector('.world-control-heading');
  const grid = workspace?.querySelector('.transfer-negotiation-grid');
  if (!workspace || !message || !heading || !grid) return false;

  ensureStyles();
  message.classList.add('transfer-feedback-banner');
  message.setAttribute('role', 'status');
  message.setAttribute('aria-live', 'polite');

  // The page-level message remains the single accessible live region and the
  // fallback when no current action-local target can be proven. Hide it only
  // after the freshly captured action changes the canonical message and its
  // visual mirror is successfully placed beside that exact action.
  if (message.previousElementSibling !== heading) heading.after(message);
  bindMessageObserver();
  mirrorFeedbackLocally();
  return true;
}

function captureFeedbackTarget(event) {
  const view = event.target.closest?.('#transfersView');
  if (!view) return;
  const control = event.target.closest?.([
    '#submitNegotiation',
    '[data-deal-response]',
    '[data-exchange-response]',
    '[data-agreed-change-action]',
    '[data-withdraw-offer]',
    '[data-withdraw-listing]',
    '[data-withdraw-legacy-offer]',
    '[data-legacy-transfer-response]'
  ].join(','));
  if (!control) {
    activeFeedbackTarget = null;
    syncGlobalFeedbackVisibility(false);
    return;
  }

  if (control.matches('[data-withdraw-listing]')) {
    if (listingActionInFlight) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    listingActionInFlight = true;
    listingAwaitingRefresh = false;
    setListingControlsDisabled(true);
  }

  const baselineText = String(transferMessage()?.textContent || '').trim();
  const common = { baselineText, capturedAt: Date.now(), confirmed: false };
  const card = control.closest('[data-first-class-deal]');
  if (card?.dataset.firstClassDeal) {
    activeFeedbackTarget = { ...common, type: 'deal', dealId: card.dataset.firstClassDeal };
  } else if (control.id === 'submitNegotiation') {
    activeFeedbackTarget = { ...common, type: 'proposal' };
  } else if (control.matches('[data-withdraw-listing]')) {
    activeFeedbackTarget = { ...common, type: 'listing', playerId: control.dataset.playerId || '' };
  } else if (control.matches('[data-legacy-transfer-response]')) {
    activeFeedbackTarget = { ...common, type: 'legacy-incoming', proposalId: control.dataset.proposalId || '' };
  } else if (control.matches('[data-withdraw-legacy-offer]')) {
    activeFeedbackTarget = { ...common, type: 'legacy-outgoing', proposalId: control.dataset.proposalId || '' };
  } else {
    activeFeedbackTarget = { ...common, type: 'proposal' };
  }

  // Clear stale local text only from the newly selected action host. The
  // canonical live region receives the real progress/success/error update;
  // only a post-click change confirms this target and suppresses the fallback.
  const host = localFeedbackHost();
  host?.querySelector(`:scope > [${LOCAL_FEEDBACK_ATTR}]`)?.remove();
  syncGlobalFeedbackVisibility(false);
  queueMicrotask(() => mirrorFeedbackLocally());
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

function armTransferObserver() {
  const root = document.getElementById('transfersView');
  if (!root || transferObserver) return;
  transferObserver = new MutationObserver(() => {
    if (activeFeedbackTarget) queueMicrotask(() => mirrorFeedbackLocally());
    if (listingActionInFlight && listingAwaitingRefresh) {
      queueMicrotask(() => releaseListingActionLock());
    }
  });
  // Deliberately scoped to Transfers: offer/listing refreshes can replace the
  // local feedback node, but match replay/world-feed DOM churn must not wake it.
  transferObserver.observe(root, { childList: true, subtree: true });
}

function schedulePlacement() {
  queueMicrotask(() => {
    armTransferObserver();
    if (placeTransferFeedback()) {
      stopPlacementObserver();
      return;
    }
    // During a portal remount the transfer workspace may not exist yet. Observe
    // only the Transfers view/body long enough to catch that mount, then detach.
    armPlacementObserver();
  });
}

document.addEventListener('click', captureFeedbackTarget, true);
window.addEventListener('tbg:portal-rendered', schedulePlacement);
document.addEventListener('tbg:view-changed', (event) => {
  if (event.detail?.view === 'transfers') schedulePlacement();
});

schedulePlacement();
