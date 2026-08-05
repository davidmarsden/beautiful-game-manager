const HISTORY_TIMEOUT_MS = 20000;
let timer = null;

function historyRoot() {
  return document.getElementById('historyView');
}

function isStillLoading(root) {
  return Boolean(root?.textContent?.includes('Loading canonical world history'));
}

function showRecovery(root) {
  if (!root || !isStillLoading(root)) return;
  root.innerHTML = `
    <div class="empty-state history-load-error" role="alert">
      <h2>History could not be loaded</h2>
      <p>The canonical history request took too long or the service was temporarily unavailable. The rest of the manager portal is still safe to use.</p>
      <button id="retryHistoryLoad" type="button">Retry History</button>
    </div>`;
  root.querySelector('#retryHistoryLoad')?.addEventListener('click', () => {
    root.innerHTML = '<div class="empty-state">Loading canonical world history…</div>';
    document.dispatchEvent(new CustomEvent('tbg:view-changed', { detail: { view: 'history', retry: true } }));
    armTimeout();
  });
}

function armTimeout() {
  window.clearTimeout(timer);
  timer = window.setTimeout(() => showRecovery(historyRoot()), HISTORY_TIMEOUT_MS);
}

document.addEventListener('tbg:view-changed', (event) => {
  if (event.detail?.view === 'history') armTimeout();
});

window.addEventListener('tbg:portal-rendered', () => {
  if (historyRoot()?.classList.contains('active')) armTimeout();
});
