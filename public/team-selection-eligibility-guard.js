function playerId(player) {
  return String(player?.tbg_player_id || player?.player_id || '').trim();
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

function applyEligibilityGuard(portal) {
  const squad = portal?.squad || [];
  if (!Array.isArray(squad) || !squad.length) return;
  const allowed = new Set(squad.filter(selectable).map(playerId));
  const unavailable = new Map(squad.filter((player) => !selectable(player)).map((player) => [playerId(player), player]));

  document.querySelectorAll('.player-pick input[data-zone]').forEach((input) => {
    const id = String(input.value || '').trim();
    const label = input.closest('.player-pick');
    if (allowed.has(id)) return;
    input.checked = false;
    input.disabled = true;
    label?.classList.add('selection-ineligible');
    const player = unavailable.get(id);
    const reason = player?.registered === false || String(player?.registration_status).toLowerCase() === 'unregistered'
      ? 'Not registered'
      : player?.loaned_out
        ? 'Loaned out'
        : String(player?.injury_status || 'Unavailable');
    if (label && !label.querySelector('.selection-ineligible-reason')) {
      label.insertAdjacentHTML('beforeend', `<small class="selection-ineligible-reason">${reason} · cannot be selected</small>`);
    }
  });

  window.dispatchEvent(new CustomEvent('tbg:selection-eligibility-updated', { detail: { allowed_player_ids: [...allowed] } }));
}

window.addEventListener('tbg:portal-rendered', (event) => {
  applyEligibilityGuard(event.detail);
  requestAnimationFrame(() => applyEligibilityGuard(event.detail));
  setTimeout(() => applyEligibilityGuard(event.detail), 100);
});

window.addEventListener('tbg:selection-submission-restored', (event) => {
  applyEligibilityGuard(event.detail || window.tbgPortalState);
});
