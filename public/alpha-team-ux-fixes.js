const norm = (value) => String(value ?? '').trim();
const TRANSFER_READY_PATTERN = /^\d+ incoming · \d+ outgoing · \d+ listed$/;

function installAlphaTeamStyles() {
  if (document.getElementById('alphaTeamUxFixes')) return;
  const style = document.createElement('style');
  style.id = 'alphaTeamUxFixes';
  style.textContent = `
    #tacticsView .reserves-jump {
      min-height: 28px;
      padding: 4px 8px;
      background: var(--tbg-brazil-yellow, #ffdc02) !important;
      color: #17212a !important;
      border: 1px solid #786a00 !important;
      font-weight: 700;
    }
    #tacticsView .reserves-jump:hover,
    #tacticsView .reserves-jump:focus-visible {
      background: #fff1a8 !important;
      color: #17212a !important;
    }
    #tacticsView .bench-slot .player-rating {
      background: var(--tbg-brazil-yellow, #ffdc02) !important;
      color: #17212a !important;
      border-color: #786a00 !important;
    }
    @media (min-width: 701px) and (max-width: 1100px) {
      #tacticsView .formation-board-shell {
        grid-template-columns: minmax(0, 1.55fr) minmax(230px, .72fr) !important;
      }
    }
  `;
  document.head.append(style);
}

function updateReservesJump() {
  const button = document.getElementById('reservesJump');
  const tray = document.getElementById('formationSquadTray');
  if (!button || !tray) return;
  const available = tray.querySelectorAll('.tray-player:not(.assigned)').length;
  button.textContent = `Reserves / available squad (${available})`;
}

function improveReservesDiscovery() {
  installAlphaTeamStyles();
  const panel = document.querySelector('#tacticsView .squad-tray-panel');
  const tray = document.getElementById('formationSquadTray');
  const toolbar = document.querySelector('#tacticsView .pitch-toolbar');
  if (!panel || !tray || !toolbar) return;

  const heading = panel.querySelector('h3');
  if (heading && heading.textContent !== 'Reserves / available squad') heading.textContent = 'Reserves / available squad';
  const help = panel.querySelector('.pitch-help');
  if (help) help.textContent = 'Your full registered and available squad is here. Players not already in the XI or on the bench are your reserves.';

  let button = document.getElementById('reservesJump');
  if (!button) {
    button = document.createElement('button');
    button.id = 'reservesJump';
    button.type = 'button';
    button.className = 'reserves-jump';
    button.addEventListener('click', () => panel.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    toolbar.append(button);
  }
  updateReservesJump();

  if (tray.dataset.reservesObserver !== 'true') {
    tray.dataset.reservesObserver = 'true';
    new MutationObserver(updateReservesJump).observe(tray, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  }
}

function waitForElement(id, attempts = 80) {
  return new Promise((resolve) => {
    const check = (remaining) => {
      const element = document.getElementById(id);
      if (element || remaining <= 0) return resolve(element || null);
      setTimeout(() => check(remaining - 1), 50);
    };
    check(attempts);
  });
}

function waitForTransferRefresh(status, attempts = 160) {
  return new Promise((resolve, reject) => {
    const check = (remaining) => {
      if (TRANSFER_READY_PATTERN.test(norm(status?.textContent))) return resolve();
      if (remaining <= 0) return reject(new Error('Transfer players are still loading. Please try List player again.'));
      setTimeout(() => check(remaining - 1), 50);
    };
    check(attempts);
  });
}

async function prepareReliableTransferListing(playerId) {
  const requestedPlayerId = norm(playerId);
  if (!requestedPlayerId) return;

  // Mark an already-mounted transfer workspace before navigation. The normal
  // transfer controller replaces this marker only after its own refresh/render
  // has completed, so this shortcut cannot race that render and lose selection.
  const existingStatus = document.getElementById('transferNegotiationStatus');
  if (existingStatus) existingStatus.textContent = 'Preparing player…';
  document.querySelector('[data-view="transfers"]')?.click();

  const [action, select, status] = await Promise.all([
    waitForElement('negotiationAction'),
    waitForElement('negotiationPlayer'),
    waitForElement('transferNegotiationStatus')
  ]);
  if (!action || !select || !status) throw new Error('Transfer listing controls are still loading.');
  await waitForTransferRefresh(status);

  action.value = 'listing';
  action.dispatchEvent(new Event('change', { bubbles: true }));
  const requestedOption = [...select.options].find((option) => norm(option.value) === requestedPlayerId);
  if (!requestedOption) throw new Error('That player is not currently available in your transfer directory.');
  select.value = requestedPlayerId;
  if (norm(select.value) !== requestedPlayerId) throw new Error('Could not select that player for listing.');
  select.dispatchEvent(new Event('change', { bubbles: true }));

  document.querySelector('[data-transfer-section="my"]')?.click();
  document.querySelector('.transfer-negotiation-compose')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const message = document.getElementById('transferNegotiationMessage');
  if (message) message.textContent = `Ready to list ${requestedOption.textContent.split(' · ')[0] || requestedPlayerId}. Set an asking fee and publish the listing.`;
}

function listingError(error) {
  const message = document.getElementById('transferNegotiationMessage');
  if (message) message.textContent = error.message;
}

document.addEventListener('click', (event) => {
  const button = event.target.closest?.('[data-squad-list-player]');
  if (!button) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  prepareReliableTransferListing(button.dataset.squadListPlayer).catch(listingError);
}, true);

window.addEventListener('tbg:formation-board-ready', improveReservesDiscovery);
window.addEventListener('tbg:portal-rendered', () => queueMicrotask(improveReservesDiscovery));
document.addEventListener('tbg:view-changed', (event) => {
  if (event.detail?.view === 'tactics') queueMicrotask(improveReservesDiscovery);
});

installAlphaTeamStyles();
queueMicrotask(improveReservesDiscovery);
