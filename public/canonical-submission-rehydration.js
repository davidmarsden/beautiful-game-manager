(() => {
  let latestState = window.tbgPortalState || null;
  let managerOverride = false;
  let rehydrationTimers = [];

  const $ = (id) => document.getElementById(id);
  const text = (value) => String(value ?? '').trim();

  function cancelRehydration() {
    rehydrationTimers.forEach((timer) => window.clearTimeout(timer));
    rehydrationTimers = [];
  }

  function currentSubmission(state = latestState) {
    const submission = state?.current_submission;
    if (!submission) return null;
    const instruction = submission.instruction && typeof submission.instruction === 'object'
      ? submission.instruction
      : {};
    const startingXi = Array.isArray(submission.starting_xi) ? submission.starting_xi : instruction.starting_xi;
    const bench = Array.isArray(submission.bench) ? submission.bench : instruction.bench;
    if (!Array.isArray(startingXi) || startingXi.length !== 11 || !Array.isArray(bench) || bench.length !== 7) return null;
    return {
      ...instruction,
      ...submission,
      starting_xi: startingXi.map(text),
      bench: bench.map(text),
      captain_id: text(submission.captain_id || instruction.captain_id),
      formation: text(submission.formation || instruction.formation),
      tactics: submission.tactics || instruction.tactics || {}
    };
  }

  function reorderSelector(containerId, zone, orderedIds) {
    const container = $(containerId);
    if (!container) return false;
    const labels = [...container.querySelectorAll('.player-pick')];
    if (!labels.length) return false;
    const labelById = new Map(labels.map((label) => {
      const input = label.querySelector(`input[data-zone="${zone}"]`);
      return [text(input?.value), label];
    }));
    const selected = new Set(orderedIds);

    labels.forEach((label) => {
      const input = label.querySelector(`input[data-zone="${zone}"]`);
      if (input) input.checked = selected.has(text(input.value));
    });
    orderedIds.forEach((playerId) => {
      const label = labelById.get(playerId);
      if (label) container.appendChild(label);
    });
    labels
      .filter((label) => !selected.has(text(label.querySelector(`input[data-zone="${zone}"]`)?.value)))
      .forEach((label) => container.appendChild(label));
    return true;
  }

  function applyCanonicalSubmission() {
    if (managerOverride) return false;
    const submission = currentSubmission();
    if (!submission) return false;
    const restoredXi = reorderSelector('startingXi', 'xi', submission.starting_xi);
    const restoredBench = reorderSelector('bench', 'bench', submission.bench);
    if (!restoredXi || !restoredBench) return false;

    if (submission.formation && $('formation')) $('formation').value = submission.formation;
    const tactics = submission.tactics || {};
    if (tactics.mentality && $('mentality')) $('mentality').value = tactics.mentality;
    if (tactics.pressing && $('pressing')) $('pressing').value = tactics.pressing;
    if (tactics.tempo && $('tempo')) $('tempo').value = tactics.tempo;
    if (tactics.width && $('width')) $('width').value = tactics.width;
    if (tactics.defensive_line && $('defensiveLine')) $('defensiveLine').value = tactics.defensive_line;

    document.querySelector('input[data-zone="xi"]')?.dispatchEvent(new Event('change', { bubbles: true }));
    window.setTimeout(() => {
      const captain = $('captain');
      if (captain && submission.captain_id) captain.value = submission.captain_id;
    }, 0);
    return true;
  }

  function scheduleCanonicalRehydration(state) {
    if (state) latestState = state;
    cancelRehydration();
    managerOverride = false;
    [0, 50, 150, 300, 600, 1200, 2500, 5000, 9000].forEach((delay) => {
      rehydrationTimers.push(window.setTimeout(applyCanonicalSubmission, delay));
    });
  }

  function markManagerOverride(event) {
    if (!event.isTrusted) return;
    if (event.target?.closest('#interactiveFormationBoard, #loadPreset, #loadPreviousMatch, #formation, #mentality, #pressing, #tempo, #width, #defensiveLine, #captain')) {
      managerOverride = true;
      cancelRehydration();
    }
  }

  document.addEventListener('click', markManagerOverride, true);
  document.addEventListener('change', markManagerOverride, true);

  window.addEventListener('tbg:portal-rendered', (event) => {
    scheduleCanonicalRehydration(event.detail || window.tbgPortalState);
  });
  window.addEventListener('tbg:formation-board-ready', () => scheduleCanonicalRehydration(latestState));
  window.addEventListener('tbg:team-submission-saved', (event) => {
    scheduleCanonicalRehydration(event.detail?.state || window.tbgPortalState);
  });
  window.addEventListener('load', () => scheduleCanonicalRehydration(window.tbgPortalState));
  window.addEventListener('pagehide', cancelRehydration, { once: true });
})();
