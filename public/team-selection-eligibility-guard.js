let lastPortal = null;

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

window.addEventListener('tbg:portal-rendered', (event) => {
  applyEligibilityGuard(event.detail);
  requestAnimationFrame(() => applyEligibilityGuard(event.detail));
  setTimeout(() => applyEligibilityGuard(event.detail), 100);
});

window.addEventListener('tbg:formation-board-ready', () => applyEligibilityGuard(lastPortal));
window.addEventListener('tbg:selection-submission-restored', (event) => {
  applyEligibilityGuard(event.detail || window.tbgPortalState);
});
