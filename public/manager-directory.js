import { openManagerParticipation } from './manager-participation.js';
import './portal-followup.js';

let loadedAt = 0;
let loading = null;
const TTL = 60_000;

function authToken() {
  const bridged = String(window.tbgPortalAuthorization || '').trim();
  if (bridged) return bridged.toLowerCase().startsWith('bearer ') ? bridged.slice(7).trim() : bridged;
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key?.startsWith('sb-') || !key.endsWith('-auth-token')) continue;
    try {
      const stored = JSON.parse(localStorage.getItem(key));
      const token = stored?.access_token || stored?.currentSession?.access_token;
      if (token) return token;
    } catch {}
  }
  return '';
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>\"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', "'": '&#39;' }[char]));
}

function host() {
  return document.getElementById('managersView');
}

function render(data) {
  const root = host();
  if (!root) return;
  const directory = Array.isArray(data.directory) ? data.directory : [];
  const hasSelf = Boolean(data.manager_name || data.club_name);
  const selfRow = hasSelf ? `
    <button type="button" class="manager-directory-list-row manager-directory-list-row-self" data-manager-directory-self>
      <span class="manager-directory-identity"><strong>${escapeHtml(data.manager_name || 'Manager')} <small class="manager-directory-you">You</small></strong><small>${escapeHtml(data.club_name || 'No club')}</small></span>
      <span class="manager-directory-club">${escapeHtml(data.division_name || data.division || '')}</span>
      <span class="manager-directory-open">View profile <span aria-hidden="true">→</span></span>
    </button>` : '';
  const rows = directory.map((manager) => `
    <button type="button" class="manager-directory-list-row" data-manager-profile-id="${escapeHtml(manager.manager_id || '')}">
      <span class="manager-directory-identity"><strong>${escapeHtml(manager.manager_name || 'Manager')}</strong><small>${escapeHtml(manager.club_name || manager.club_id || 'No club')}</small></span>
      <span class="manager-directory-club">${escapeHtml(manager.division_name || manager.division || '')}</span>
      <span class="manager-directory-open">View profile <span aria-hidden="true">→</span></span>
    </button>`).join('');
  const appointedCount = directory.length + (hasSelf ? 1 : 0);

  root.innerHTML = `<section class="manager-directory-shell">
    <header class="manager-directory-heading">
      <div><small>THE MANAGERS</small><h2>Managers</h2><p>Everyone running a club in this world. Open a manager profile for public pins, recent participation and contact details they chose to share.</p></div>
      <button type="button" class="manager-directory-self" data-manager-directory-self>My profile</button>
    </header>
    <div class="manager-directory-summary"><strong>${appointedCount}</strong><span>appointed managers</span></div>
    <div class="manager-directory-list" role="list">${selfRow}${rows}${appointedCount ? '' : '<p class="manager-directory-empty">No appointed managers are available yet.</p>'}</div>
  </section>`;
}

async function loadDirectory({ force = false } = {}) {
  const root = host();
  if (!root) return;
  if (!force && Date.now() - loadedAt < TTL && root.querySelector('.manager-directory-shell')) return;
  if (loading) return loading;
  const token = authToken();
  if (!token) {
    root.innerHTML = '<div class="empty-state">Sign in to view managers.</div>';
    return;
  }
  root.innerHTML = '<div class="empty-state">Loading managers…</div>';
  loading = fetch('/api/manager-participation', { headers: { authorization: `Bearer ${token}` } })
    .then(async (response) => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not load managers');
      render(data);
      loadedAt = Date.now();
    })
    .catch((error) => {
      const current = host();
      if (current) current.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
    })
    .finally(() => { loading = null; });
  return loading;
}

document.addEventListener('click', (event) => {
  if (!event.target.closest?.('[data-manager-directory-self]')) return;
  event.preventDefault();
  void openManagerParticipation('');
});

document.addEventListener('tbg:view-changed', (event) => {
  if (event.detail?.view === 'managers') void loadDirectory();
});
window.addEventListener('tbg:portal-rendered', () => { loadedAt = 0; });
window.addEventListener('tbg:world-feed-mutation-succeeded', () => { loadedAt = 0; });

export { loadDirectory };
