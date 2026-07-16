// Hotfix for PR #16 tablet tap-to-swap.
// Captures a selected squad player and performs a true two-way swap in the
// hidden ordered selectors before the formation board's own click handler runs.

const q = (selector, root = document) => root.querySelector(selector);
const qa = (selector, root = document) => [...root.querySelectorAll(selector)];
const id = (value) => String(value ?? '');

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

function selectedTrayPlayer(board) {
  return q('.tray-player.selected[data-player-id]', board)?.dataset.playerId || null;
}

function slotPlayerId(slot) {
  return q('[data-player-id]', slot)?.dataset.playerId || null;
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
  q('input[data-zone="xi"]')?.dispatchEvent(new Event('change', { bubbles: true }));
  targetSlot.blur();
}

function install() {
  const board = document.getElementById('interactiveFormationBoard');
  if (!board || board.dataset.touchSwapFixed === 'true') return false;
  board.dataset.touchSwapFixed = 'true';

  board.addEventListener('click', (event) => {
    const targetSlot = event.target.closest('[data-zone][data-index]');
    if (!targetSlot) return;
    const movingId = selectedTrayPlayer(board);
    if (!movingId) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    applySwap(board, id(movingId), targetSlot);
  }, true);
  return true;
}

const observer = new MutationObserver(() => install());
window.addEventListener('load', () => {
  install();
  observer.observe(document.body, { childList: true, subtree: true });
});
