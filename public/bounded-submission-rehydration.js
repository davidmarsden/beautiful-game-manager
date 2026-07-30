(() => {
  let released = false;
  let fallbackTimer = null;
  let releasePulse = null;
  let releasePulseDeadline = 0;

  function dispatchRelease(source) {
    document.dispatchEvent(new CustomEvent('tbg:team-sheet-override', {
      detail: { source }
    }));
  }

  function stopReleasePulse() {
    if (releasePulse) window.clearInterval(releasePulse);
    releasePulse = null;
  }

  function releaseSubmissionGuard(source) {
    released = true;
    window.tbgSubmissionRehydrationReleased = true;
    if (fallbackTimer) window.clearTimeout(fallbackTimer);
    dispatchRelease(source);

    // A formation-ready event can arrive before phase2c2b has finished its own
    // bootstrap and created the observer. Keep issuing bounded release pulses so
    // any observer created late is disconnected promptly instead of surviving
    // for the lifetime of the page.
    releasePulseDeadline = Math.max(releasePulseDeadline, Date.now() + 30000);
    if (!releasePulse) {
      releasePulse = window.setInterval(() => {
        if (Date.now() >= releasePulseDeadline) {
          stopReleasePulse();
          return;
        }
        dispatchRelease('rehydration_release_latch');
      }, 250);
    }
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

  window.addEventListener('pagehide', stopReleasePulse, { once: true });
})();
