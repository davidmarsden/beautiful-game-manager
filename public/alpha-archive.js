const MUTATION_SELECTORS = [
  '#decisionForm button[type="submit"]',
  '#decisionForm input',
  '#decisionForm select',
  '.team-preset-panel button',
  '.bulk-registration-panel button',
  '.open-market-actions button',
  '.transfer-negotiations button',
  '[data-transfer-action]',
  '[data-world-command]',
  '#markAllInboxRead'
];

function applyArchiveMode(detail = window.tbgPortalState || null) {
  const archive = detail?.archive;
  if (!archive?.read_only) return;

  document.documentElement.dataset.tbgArchive = 'alpha1';
  const banner = document.getElementById('archiveBanner');
  if (banner) {
    banner.hidden = false;
    const date = archive.archived_at ? new Date(archive.archived_at).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : '';
    const text = banner.querySelector('span');
    if (text) text.textContent = `Alpha 1 ended${date ? ` on ${date}` : ''}. This world is preserved for reference: you can browse it, but game actions are read-only.`;
  }

  document.querySelectorAll(MUTATION_SELECTORS.join(',')).forEach((control) => {
    control.disabled = true;
    control.setAttribute('aria-disabled', 'true');
    control.title = 'Alpha 1 is archived and read-only';
  });

  document.querySelectorAll('form').forEach((form) => {
    if (form.closest('#passwordDialog') || form.id === 'loginForm') return;
    form.addEventListener('submit', blockArchivedSubmit, { capture: true });
  });
}

function blockArchivedSubmit(event) {
  if (document.documentElement.dataset.tbgArchive !== 'alpha1') return;
  event.preventDefault();
  event.stopImmediatePropagation();
}

window.addEventListener('tbg:portal-rendered', (event) => applyArchiveMode(event.detail));
window.addEventListener('tbg:portal-state', (event) => applyArchiveMode(event.detail));
document.addEventListener('DOMContentLoaded', () => applyArchiveMode());
new MutationObserver(() => applyArchiveMode()).observe(document.documentElement, { childList: true, subtree: true });
