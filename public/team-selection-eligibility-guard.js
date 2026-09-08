let lastPortal = null;
let transferBootstrapInFlight = null;

function playerId(player) {
  return String(player?.tbg_player_id || player?.player_id || '').trim();
}

function selectionReason(player) {
  if (player?.registered === false || String(player?.registration_status || '').toLowerCase() === 'unregistered') return 'Unregistered';
  if (player?.loaned_out) return 'Loaned out';
  return String(player?.injury_status || 'Unavailable');
}

function selectable(player) {
  return Boolean(
    playerId(player)
    && player?.registered !== false
    && String(player?.registration_status || 'registered').toLowerCase() !== 'unregistered'
    && String(player?.injury_status || 'Available').toLowerCase() === 'available'
    && !player?.loaned_out
  );
}

function playerLabelText(player) {
  const name = String(player?.display_name || player?.player_name || playerId(player)).trim();
  const position = String(player?.specific_position || player?.position || player?.primary_position || player?.position_group || 'Unknown').trim();
  const rating = player?.underlying_ability_rating ?? player?.tbg_rating ?? player?.rating ?? '—';
  return `${name} · ${position} · ${rating}`;
}

function appendMissingPlayerLabel(container, zone, player) {
  const id = playerId(player);
  if (!container || !id || player?.loaned_out) return;
  const exists = [...container.querySelectorAll('.player-pick input[data-zone]')]
    .some((input) => String(input.value || '').trim() === id);
  if (exists) return;

  const label = document.createElement('label');
  label.className = 'player-pick';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.dataset.zone = zone;
  input.value = id;
  const span = document.createElement('span');
  span.textContent = playerLabelText(player);
  label.append(input, span);
  container.append(label);
}

function reconcileCanonicalSquadSelectors(portal) {
  const squad = Array.isArray(portal?.squad) ? portal.squad : [];
  if (!squad.length) return;
  const startingXi = document.getElementById('startingXi');
  const bench = document.getElementById('bench');
  squad.forEach((player) => {
    appendMissingPlayerLabel(startingXi, 'xi', player);
    appendMissingPlayerLabel(bench, 'bench', player);
  });
}

function annotateSquadRows(squad) {
  const byName = new Map(squad.map((player) => [String(player.display_name || player.player_name || '').trim(), player]));
  document.querySelectorAll('#squadRows tr').forEach((row) => {
    const name = row.querySelector('.player-link')?.textContent?.trim();
    const player = byName.get(name);
    if (!player || selectable(player)) return;
    const cells = row.querySelectorAll('td');
    const availabilityCell = cells[7];
    if (availabilityCell) availabilityCell.innerHTML = `<span class="badge injured">${selectionReason(player)}</span>`;
    row.classList.add('selection-ineligible');
  });
}

function applyEligibilityGuard(portal) {
  lastPortal = portal || lastPortal;
  const squad = lastPortal?.squad || [];
  if (!Array.isArray(squad) || !squad.length) return;
  const allowed = new Set(squad.filter(selectable).map(playerId));
  const unavailable = new Map(squad.filter((player) => !selectable(player)).map((player) => [playerId(player), player]));

  document.querySelectorAll('.player-pick input[data-zone]').forEach((input) => {
    const id = String(input.value || '').trim();
    const label = input.closest('.player-pick');
    if (allowed.has(id)) {
      input.disabled = false;
      label?.classList.remove('selection-ineligible');
      if (label) delete label.dataset.selectionIneligible;
      label?.querySelector('.selection-ineligible-reason')?.remove();
      return;
    }
    input.checked = false;
    input.disabled = true;
    label?.classList.add('selection-ineligible');
    if (label) label.dataset.selectionIneligible = 'true';
    const player = unavailable.get(id);
    const reason = selectionReason(player);
    if (label && !label.querySelector('.selection-ineligible-reason')) {
      label.insertAdjacentHTML('beforeend', `<small class="selection-ineligible-reason">${reason} · cannot be selected</small>`);
    }
  });

  annotateSquadRows(squad);
  window.dispatchEvent(new CustomEvent('tbg:selection-eligibility-updated', { detail: { allowed_player_ids: [...allowed] } }));
}

async function refreshPortalAfterTransfer() {
  const authorization = String(window.tbgPortalAuthorization || '').trim();
  if (!authorization) return;
  if (transferBootstrapInFlight) return transferBootstrapInFlight;
  transferBootstrapInFlight = fetch('/api/bootstrap', {
    headers: { authorization },
    cache: 'no-store'
  }).finally(() => {
    transferBootstrapInFlight = null;
  });
  return transferBootstrapInFlight;
}

window.addEventListener('tbg:portal-rendered', (event) => {
  lastPortal = event.detail || lastPortal;
  reconcileCanonicalSquadSelectors(lastPortal);
}, true);

window.addEventListener('tbg:portal-rendered', (event) => {
  applyEligibilityGuard(event.detail);
  requestAnimationFrame(() => applyEligibilityGuard(event.detail));
  setTimeout(() => applyEligibilityGuard(event.detail), 100);
});

window.addEventListener('tbg:formation-board-ready', () => applyEligibilityGuard(lastPortal));
window.addEventListener('tbg:selection-submission-restored', (event) => {
  applyEligibilityGuard(event.detail || window.tbgPortalState);
});
document.addEventListener('tbg:transfer-history-refresh', () => {
  refreshPortalAfterTransfer().catch((error) => console.warn('Could not refresh team selection after transfer', error));
});
