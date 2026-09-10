// Early interaction bridge for formation-board selection.
// The formation board is subsequently decorated by several enhancement layers.
// Keep the selection listener on document capture phase so DOM rewrites cannot
// detach it and later capture handlers cannot swallow a manager's click first.

const q = (selector, root = document) => root.querySelector(selector);
const qa = (selector, root = document) => [...root.querySelectorAll(selector)];
const id = (value) => String(value ?? '');
let pendingPlayerId = null;
let interactionInstalled = false;

function diagnosticHost(board) {
  let host = board?.querySelector('[data-formation-selection-diagnostic]');
  if (host) return host;
  const trayPanel = board?.querySelector('.squad-tray-panel');
  if (!trayPanel) return null;
  host = document.createElement('p');
  host.dataset.formationSelectionDiagnostic = 'true';
  host.className = 'pitch-help';
  host.setAttribute('aria-live', 'polite');
  host.textContent = 'Selection diagnostic ready.';
  trayPanel.insertBefore(host, trayPanel.querySelector('#formationSquadTray'));
  return host;
}

function setDiagnostic(board, message) {
  const host = diagnosticHost(board);
  if (host) host.textContent = `Selection diagnostic: ${message}`;
}

function hiddenSelectorState(playerId) {
  const escaped = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(playerId) : playerId.replace(/["\\]/g, '\\$&');
  const xi = q(`#startingXi input[data-zone="xi"][value="${escaped}"]`);
  const bench = q(`#bench input[data-zone="bench"][value="${escaped}"]`);
  const describe = (input) => input ? `${input.disabled ? 'disabled' : 'enabled'}${input.checked ? ', checked' : ', unchecked'}` : 'missing';
  return `XI ${describe(xi)}; bench ${describe(bench)}`;
}

function orderedChecked(zone) {
  return qa(`input[data-zone="${zone}"]:checked`).map((input) => id(input.value));
}

function reorderAndCheck(containerId, zone, orderedIds) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const labels = qa('.player-pick', container);
  const byPlayer = new Map(labels.map((label) => [id(q('input', label)?.value), label]));
  const selected = new Set(orderedIds.filter(Boolean));

  labels.forEach((label) => {
    const input = q('input', label);
    if (input) input.checked = selected.has(id(input.value));
  });
  orderedIds.filter(Boolean).forEach((playerId) => {
    const label = byPlayer.get(id(playerId));
    if (label) container.appendChild(label);
  });
  labels.filter((label) => !selected.has(id(q('input', label)?.value))).forEach((label) => container.appendChild(label));
}

function slotPlayerId(slot) {
  return q('[data-player-id]', slot)?.dataset.playerId || null;
}

function authoriseBoardImport(source) {
  document.dispatchEvent(new CustomEvent('tbg:team-sheet-override', {
    detail: { source }
  }));
}

function importHiddenTeamIntoBoard(source) {
  authoriseBoardImport(source);
  q('input[data-zone="xi"]')?.dispatchEvent(new Event('change', { bubbles: true }));
}

function applySwap(board, movingId, targetSlot) {
  const xi = orderedChecked('xi');
  const bench = orderedChecked('bench');
  const targetZone = targetSlot.dataset.zone;
  const targetIndex = Number(targetSlot.dataset.index);
  const displacedId = slotPlayerId(targetSlot);

  const sourceXi = xi.indexOf(movingId);
  const sourceBench = bench.indexOf(movingId);
  const cleanXi = xi.map((playerId) => playerId === movingId ? null : playerId);
  const cleanBench = bench.map((playerId) => playerId === movingId ? null : playerId);
  const target = targetZone === 'xi' ? cleanXi : cleanBench;
  target[targetIndex] = movingId;

  if (displacedId && displacedId !== movingId) {
    if (sourceXi >= 0) cleanXi[sourceXi] = displacedId;
    else if (sourceBench >= 0) cleanBench[sourceBench] = displacedId;
  }

  setDiagnostic(board, `attempting ${movingId} → ${targetZone.toUpperCase()} slot ${targetIndex + 1}; ${hiddenSelectorState(movingId)}`);
  reorderAndCheck('startingXi', 'xi', cleanXi);
  reorderAndCheck('bench', 'bench', cleanBench);
  pendingPlayerId = null;
  importHiddenTeamIntoBoard('formation_selection_bridge');
  targetSlot.blur();

  setTimeout(() => {
    const slotSelector = targetZone === 'xi'
      ? `#formationPitch [data-zone="xi"][data-index="${targetIndex}"]`
      : `#formationBench [data-zone="bench"][data-index="${targetIndex}"]`;
    const renderedId = slotPlayerId(q(slotSelector));
    setDiagnostic(board, renderedId === movingId
      ? `placed ${movingId} in ${targetZone.toUpperCase()} slot ${targetIndex + 1}.`
      : `placement rejected; ${targetZone.toUpperCase()} slot ${targetIndex + 1} contains ${renderedId || 'nobody'}; ${hiddenSelectorState(movingId)}.`);
  }, 0);
}

function currentBoardForTarget(target) {
  const board = document.getElementById('interactiveFormationBoard');
  return board && target instanceof Element && board.contains(target) ? board : null;
}

function handleFormationClick(event) {
  const board = currentBoardForTarget(event.target);
  if (!board) return;

  diagnosticHost(board);
  const trayPlayer = event.target.closest('.tray-player[data-player-id]');
  if (trayPlayer) {
    pendingPlayerId = id(trayPlayer.dataset.playerId);
    setDiagnostic(board, `captured ${pendingPlayerId}; ${hiddenSelectorState(pendingPlayerId)}. Click an XI or bench slot.`);
    return;
  }

  const targetSlot = event.target.closest('[data-zone][data-index]');
  if (!targetSlot || !pendingPlayerId) return;

  event.preventDefault();
  event.stopImmediatePropagation();
  applySwap(board, pendingPlayerId, targetSlot);
}

function install() {
  const board = document.getElementById('interactiveFormationBoard');
  if (board) diagnosticHost(board);
  if (interactionInstalled) return Boolean(board);
  interactionInstalled = true;
  document.addEventListener('click', handleFormationClick, true);
  return Boolean(board);
}

// Captain and tactics live outside formation-board.js, but they are part of the
// same unsaved manager-owned team sheet. Preserve a newly chosen captain before
// the explicit import handshake synchronously refreshes the XI and rebuilds the
// captain select.
document.addEventListener('change', (event) => {
  if (!event.isTrusted) return;
  if (!event.target?.matches('#captain, #mentality, #pressing, #tempo, #width, #defensiveLine')) return;
  if (event.target.id === 'captain') {
    document.dispatchEvent(new CustomEvent('tbg:captain-selected', {
      detail: { captain_id: id(event.target.value) }
    }));
  }
  importHiddenTeamIntoBoard('captain_or_tactics_change');
}, true);

const observer = new MutationObserver(() => install());
install();
window.addEventListener('load', () => {
  install();
  observer.observe(document.body, { childList: true, subtree: true });
});
