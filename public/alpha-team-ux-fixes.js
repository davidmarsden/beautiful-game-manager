const norm = (value) => String(value ?? '').trim();

function accessToken() {
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

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function playerOption(player) {
  const label = [player.player_name || player.player_id, player.position, player.rating].filter((value) => value !== null && value !== undefined && value !== '').join(' · ');
  return `<option value="${escapeHtml(player.player_id)}">${escapeHtml(label)}</option>`;
}

async function transferDirectory(attempt = 0) {
  const token = accessToken();
  if (!token) throw new Error('Sign in again to load your transfer players.');
  const response = await fetch('/api/transfer-negotiations', {
    headers: { authorization: `Bearer ${token}` },
    cache: 'no-store'
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Could not load transfer players (HTTP ${response.status})`);
  if (data.processing && attempt < 8) {
    await new Promise((resolve) => setTimeout(resolve, 300));
    return transferDirectory(attempt + 1);
  }
  return data;
}

function waitForElement(id, attempts = 20) {
  return new Promise((resolve) => {
    const check = (remaining) => {
      const element = document.getElementById(id);
      if (element || remaining <= 0) return resolve(element || null);
      setTimeout(() => check(remaining - 1), 50);
    };
    check(attempts);
  });
}

async function prepareReliableTransferListing(playerId) {
  const requestedPlayerId = norm(playerId);
  if (!requestedPlayerId) return;
  document.querySelector('[data-view="transfers"]')?.click();

  const [action, select, data] = await Promise.all([
    waitForElement('negotiationAction'),
    waitForElement('negotiationPlayer'),
    transferDirectory()
  ]);
  if (!action || !select) throw new Error('Transfer listing controls are still loading.');

  const ownClubId = norm(data.club_id);
  const ownPlayers = (data.directory?.players || []).filter((player) => norm(player.club_id) === ownClubId);
  const requested = ownPlayers.find((player) => norm(player.player_id) === requestedPlayerId);
  if (!requested) throw new Error('That player is not currently available in your transfer directory.');

  action.value = 'listing';
  action.dispatchEvent(new Event('change', { bubbles: true }));
  select.innerHTML = ownPlayers.map(playerOption).join('') || '<option value="">No players available</option>';
  select.value = requestedPlayerId;
  select.dispatchEvent(new Event('change', { bubbles: true }));

  document.querySelector('[data-transfer-section="my"]')?.click();
  document.querySelector('.transfer-negotiation-compose')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const message = document.getElementById('transferNegotiationMessage');
  if (message) message.textContent = `Ready to list ${requested.player_name || requestedPlayerId}. Set an asking fee and publish the listing.`;
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
