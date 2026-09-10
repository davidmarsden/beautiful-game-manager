// Early interaction bridge for formation-board selection.
// The formation board is subsequently decorated by several enhancement layers.
// Keep selection on document capture phase so DOM rewrites cannot detach it and
// later capture handlers cannot swallow a manager's interaction first.

const q = (selector, root = document) => root.querySelector(selector);
const qa = (selector, root = document) => [...root.querySelectorAll(selector)];
const id = (value) => String(value ?? '');
let pendingPlayerId = null;
let interactionInstalled = false;

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

  reorderAndCheck('startingXi', 'xi', cleanXi);
  reorderAndCheck('bench', 'bench', cleanBench);
  pendingPlayerId = null;
  importHiddenTeamIntoBoard('formation_selection_bridge');
  targetSlot.blur();
}

function containsPoint(element, x, y) {
  if (!element || !Number.isFinite(x) || !Number.isFinite(y)) return false;
  const rect = element.getBoundingClientRect();
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

function currentBoardForInteraction(event) {
  const board = document.getElementById('interactiveFormationBoard');
  if (!board) return null;
  if (event.target instanceof Element && board.contains(event.target)) return board;
  return containsPoint(board, event.clientX, event.clientY) ? board : null;
}

function elementAtPoint(elements, x, y) {
  return elements.find((element) => containsPoint(element, x, y)) || null;
}

function trayPlayerForInteraction(board, event) {
  const direct = event.target instanceof Element ? event.target.closest('.tray-player[data-player-id]') : null;
  if (direct && board.contains(direct)) return direct;
  return elementAtPoint(qa('#formationSquadTray .tray-player[data-player-id]', board), event.clientX, event.clientY);
}

function slotForInteraction(board, event) {
  const direct = event.target instanceof Element ? event.target.closest('[data-zone][data-index]') : null;
  if (direct && board.contains(direct)) return direct;
  return elementAtPoint(qa('#formationPitch [data-zone][data-index], #formationBench [data-zone][data-index]', board), event.clientX, event.clientY);
}

function capturePlayer(player) {
  pendingPlayerId = id(player.dataset.playerId);
}

function handleFormationPointer(event) {
  const board = currentBoardForInteraction(event);
  if (!board) return;

  const trayPlayer = trayPlayerForInteraction(board, event);
  if (trayPlayer) {
    capturePlayer(trayPlayer);
    return;
  }

  const targetSlot = slotForInteraction(board, event);
  if (!targetSlot || !pendingPlayerId) return;

  event.preventDefault();
  event.stopImmediatePropagation();
  applySwap(board, pendingPlayerId, targetSlot);
}

function handleFormationClick(event) {
  const board = currentBoardForInteraction(event);
  if (!board) return;

  const trayPlayer = trayPlayerForInteraction(board, event);
  if (trayPlayer) {
    capturePlayer(trayPlayer);
    return;
  }

  const targetSlot = slotForInteraction(board, event);
  if (!targetSlot || !pendingPlayerId) return;

  event.preventDefault();
  event.stopImmediatePropagation();
  applySwap(board, pendingPlayerId, targetSlot);
}

function install() {
  if (interactionInstalled) return Boolean(document.getElementById('interactiveFormationBoard'));
  interactionInstalled = true;
  document.addEventListener('pointerdown', handleFormationPointer, true);
  document.addEventListener('click', handleFormationClick, true);
  return Boolean(document.getElementById('interactiveFormationBoard'));
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

install();
