// PR #18: make the rendered formation board authoritative at submit time.
// The tablet swap hotfix updates the visual board and hidden selectors, but the
// original formation-board capture handler can subsequently rewrite those
// selectors from stale in-memory assignments. This handler runs later in the
// same capture phase and serialises the final rendered pitch/bench order before
// app.js builds the API payload.

const qAll = (selector, root = document) => [...root.querySelectorAll(selector)];
const playerId = (value) => String(value ?? '');
let pendingCaptainId = null;

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
  if (!board) return false;

  const xi = orderedBoardIds('xi');
  const bench = orderedBoardIds('bench');
  writeOrderedSelectors('startingXi', 'xi', xi);
  writeOrderedSelectors('bench', 'bench', bench);

  document.querySelector('input[data-zone="xi"]')?.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

function restorePendingCaptain() {
  if (!pendingCaptainId) return false;
  const captain = document.getElementById('captain');
  if (!captain || ![...captain.options].some((option) => playerId(option.value) === pendingCaptainId)) return false;
  captain.value = pendingCaptainId;
  return true;
}

function replacePendingCaptainFromLoadedSheet() {
  const captain = document.getElementById('captain');
  pendingCaptainId = captain ? playerId(captain.value) || null : null;
}

window.tbgPersistRenderedBoard = persistRenderedBoard;

document.addEventListener('tbg:captain-selected', (event) => {
  pendingCaptainId = playerId(event.detail?.captain_id) || null;
});

// Fallback for browsers/paths that do not pass through the tablet touch bridge.
document.addEventListener('change', (event) => {
  if (event.target?.id !== 'captain' || !event.isTrusted) return;
  pendingCaptainId = playerId(event.target.value);
}, true);

document.addEventListener('tbg:team-sheet-override', (event) => {
  // Captain/tactics edits deliberately trigger an XI import only to mark the
  // current sheet as manager-edited. They are not a request to load another
  // sheet, so do not erase the captain value captured earlier in the same turn.
  if (event.detail?.source === 'captain_or_tactics_change') return;
  pendingCaptainId = null;
  requestAnimationFrame(replacePendingCaptainFromLoadedSheet);
  setTimeout(replacePendingCaptainFromLoadedSheet, 100);
});

document.addEventListener('click', (event) => {
  if (event.target?.closest('#loadPreset, #loadPreviousMatch')) pendingCaptainId = null;
}, true);

window.addEventListener('tbg:portal-rendered', () => {
  requestAnimationFrame(restorePendingCaptain);
  setTimeout(restorePendingCaptain, 100);
});

window.addEventListener('tbg:team-submission-saved', () => {
  pendingCaptainId = null;
});

document.addEventListener('submit', (event) => {
  if (event.target?.id === 'decisionForm') {
    restorePendingCaptain();
    persistRenderedBoard();
  }
}, true);

// Preset controls read the hidden selectors directly. Synchronise those selectors
// from the visible board before their click handlers capture a new or updated preset.
document.addEventListener('click', (event) => {
  if (event.target?.closest('#savePreset, #updatePreset')) persistRenderedBoard();
}, true);
