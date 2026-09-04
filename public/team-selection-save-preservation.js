const norm = (value) => String(value ?? '').trim();
let pendingSnapshot = null;
let restoreScheduled = false;

function orderedVisibleIds(zone) {
  const selector = zone === 'xi'
    ? '#formationPitch [data-zone="xi"][data-index]'
    : '#formationBench [data-zone="bench"][data-index]';
  return [...document.querySelectorAll(selector)]
    .sort((left, right) => Number(left.dataset.index) - Number(right.dataset.index))
    .map((slot) => norm(slot.querySelector('[data-player-id]')?.dataset.playerId))
    .filter(Boolean);
}

function legacyIds(zone) {
  return [...document.querySelectorAll(`input[data-zone="${zone}"]:checked:not(:disabled)`)]
    .map((input) => norm(input.value))
    .filter(Boolean);
}

function captureSnapshot() {
  const boardReady = document.getElementById('interactiveFormationBoard');
  const startingXi = boardReady ? orderedVisibleIds('xi') : legacyIds('xi');
  const bench = boardReady ? orderedVisibleIds('bench') : legacyIds('bench');
  if (startingXi.length !== 11 || bench.length !== 7) return null;
  return {
    startingXi,
    bench,
    captainId: norm(document.getElementById('captain')?.value),
    formation: norm(document.getElementById('formation')?.value),
    tactics: {
      mentality: norm(document.getElementById('mentality')?.value),
      pressing: norm(document.getElementById('pressing')?.value),
      tempo: norm(document.getElementById('tempo')?.value),
      width: norm(document.getElementById('width')?.value),
      defensiveLine: norm(document.getElementById('defensiveLine')?.value)
    }
  };
}

function writeOrderedSelectors(containerId, zone, orderedIds) {
  const container = document.getElementById(containerId);
  if (!container) return false;
  const labels = [...container.querySelectorAll('.player-pick')];
  const byId = new Map(labels.map((label) => {
    const input = label.querySelector(`input[data-zone="${zone}"]`);
    return [norm(input?.value), label];
  }));
  const selected = new Set(orderedIds);
  labels.forEach((label) => {
    const input = label.querySelector(`input[data-zone="${zone}"]`);
    if (input) input.checked = !input.disabled && selected.has(norm(input.value));
  });
  orderedIds.forEach((id) => {
    const label = byId.get(id);
    if (label) container.appendChild(label);
  });
  labels.filter((label) => !selected.has(norm(label.querySelector(`input[data-zone="${zone}"]`)?.value)))
    .forEach((label) => container.appendChild(label));
  return true;
}

function restoreControls(snapshot) {
  const values = {
    formation: snapshot.formation,
    mentality: snapshot.tactics.mentality,
    pressing: snapshot.tactics.pressing,
    tempo: snapshot.tactics.tempo,
    width: snapshot.tactics.width,
    defensiveLine: snapshot.tactics.defensiveLine,
    captain: snapshot.captainId
  };
  Object.entries(values).forEach(([id, value]) => {
    const control = document.getElementById(id);
    if (!control || !value) return;
    if ([...control.options || []].some((option) => norm(option.value) === value || norm(option.textContent) === value)) control.value = value;
  });
}

function restoreSnapshot() {
  if (!pendingSnapshot || restoreScheduled) return;
  restoreScheduled = true;
  queueMicrotask(() => {
    restoreScheduled = false;
    if (!pendingSnapshot) return;
    const snapshot = pendingSnapshot;
    writeOrderedSelectors('startingXi', 'xi', snapshot.startingXi);
    writeOrderedSelectors('bench', 'bench', snapshot.bench);
    restoreControls(snapshot);
    document.dispatchEvent(new CustomEvent('tbg:team-sheet-override', { detail: { source: 'save_failure_restore' } }));
    requestAnimationFrame(() => restoreControls(snapshot));
  });
}

function observeSubmissionStatus() {
  const status = document.getElementById('submissionStatus');
  if (!status || status.dataset.savePreservationObserved === 'true') return;
  status.dataset.savePreservationObserved = 'true';
  new MutationObserver(() => {
    if (pendingSnapshot && status.classList.contains('error')) restoreSnapshot();
  }).observe(status, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
}

document.addEventListener('submit', (event) => {
  if (event.target?.id !== 'decisionForm') return;
  pendingSnapshot = captureSnapshot();
}, true);

window.addEventListener('tbg:team-submission-saved', (event) => {
  if (event.detail?.state?.current_submission && !event.detail?.refresh_error) {
    pendingSnapshot = null;
    return;
  }
  if (pendingSnapshot) restoreSnapshot();
});

window.addEventListener('tbg:portal-rendered', observeSubmissionStatus);
window.addEventListener('DOMContentLoaded', observeSubmissionStatus);
queueMicrotask(observeSubmissionStatus);
