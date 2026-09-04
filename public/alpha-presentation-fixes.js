const FAST_REPLAY_INTERVAL = '180';

function syncFastReplayMode() {
  const modal = document.getElementById('matchCentreModal');
  const speed = document.getElementById('replaySpeed');
  if (!modal) return;
  modal.dataset.fastReplay = speed?.value === FAST_REPLAY_INTERVAL ? 'true' : 'false';
}

document.addEventListener('change', (event) => {
  if (event.target?.id === 'replaySpeed') syncFastReplayMode();
});

new MutationObserver(() => syncFastReplayMode())
  .observe(document.documentElement, { childList: true, subtree: true });

window.addEventListener('tbg:match-revealed', syncFastReplayMode);
queueMicrotask(syncFastReplayMode);
