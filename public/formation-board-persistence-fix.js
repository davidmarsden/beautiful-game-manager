// PR #18: make the rendered formation board authoritative at submit time.
// The tablet swap hotfix updates the visual board and hidden selectors, but the
// original formation-board capture handler can subsequently rewrite those
// selectors from stale in-memory assignments. This handler runs later in the
// same capture phase and serialises the final rendered pitch/bench order before
// app.js builds the API payload.

const qAll = (selector, root = document) => [...root.querySelectorAll(selector)];
const playerId = (value) => String(value ?? '');

function orderedBoardIds(zone) {
  const selector = zone === 'xi'
    ? '#formationPitch [data-zone="xi"][data-index]'
    : '#formationBench [data-zone="bench"][data-index]';

  return qAll(selector)
    .sort((a, b) => Number(a.dataset.index) - Number(b.dataset.index))
    .map((slot) => playerId(slot.querySelector('[data-player-id]')?.dataset.playerId))
    .filter(Boolean);
}

function writeOrderedSelectors(containerId, zone, orderedIds) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const labels = qAll('.player-pick', container);
  const labelById = new Map(labels.map((label) => {
    const input = label.querySelector(`input[data-zone="${zone}"]`);
    return [playerId(input?.value), label];
  }));
  const selected = new Set(orderedIds);

  labels.forEach((label) => {
    const input = label.querySelector(`input[data-zone="${zone}"]`);
    if (input) input.checked = selected.has(playerId(input.value));
  });

  orderedIds.forEach((id) => {
    const label = labelById.get(id);
    if (label) container.appendChild(label);
  });

  labels
    .filter((label) => !selected.has(playerId(label.querySelector(`input[data-zone="${zone}"]`)?.value)))
    .forEach((label) => container.appendChild(label));
}

function persistRenderedBoard() {
  const board = document.getElementById('interactiveFormationBoard');
  if (!board) return;

  const xi = orderedBoardIds('xi');
  const bench = orderedBoardIds('bench');
  writeOrderedSelectors('startingXi', 'xi', xi);
  writeOrderedSelectors('bench', 'bench', bench);

  // Rebuild captain choices from the final XI before app.js reads the form.
  document.querySelector('input[data-zone="xi"]')?.dispatchEvent(new Event('change', { bubbles: true }));
}

document.addEventListener('submit', (event) => {
  if (event.target?.id === 'decisionForm') persistRenderedBoard();
}, true);
