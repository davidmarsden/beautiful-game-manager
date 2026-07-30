(() => {
  let released = false;
  let fallbackTimer = null;

  function releaseSubmissionGuard(source) {
    if (released) return;
    released = true;
    if (fallbackTimer) window.clearTimeout(fallbackTimer);
    document.dispatchEvent(new CustomEvent('tbg:team-sheet-override', {
      detail: { source }
    }));
  }

  // phase2c2b restores the persisted XI/bench into the hidden selectors while the
  // formation board is being built. Once the board is ready, allow one final
  // refresh cycle and then disconnect its startup MutationObserver. Keeping that
  // observer alive indefinitely can make it fight later board renders and lock up
  // lower-memory tablet browsers.
  window.addEventListener('tbg:formation-board-ready', () => {
    window.setTimeout(() => releaseSubmissionGuard('formation_board_ready'), 400);
  }, { once: true });

  // If the interactive board is unavailable, keep the protection only for a
  // bounded startup window. The legacy selectors will still contain the restored
  // team, but no observer is allowed to run forever.
  window.addEventListener('tbg:portal-rendered', () => {
    fallbackTimer = window.setTimeout(() => releaseSubmissionGuard('rehydration_timeout'), 8000);
  }, { once: true });
})();
