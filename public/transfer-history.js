const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const formatMoney = (value) => `£${Math.max(0, Number(value) || 0).toLocaleString('en-GB')}`;
const formatDate = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' });
};

let lastLoadedAt = 0;
let loading = null;
const TTL = 60_000;

function storedAccessToken() {
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

function historyHost() {
  const grid = document.querySelector('#transferNegotiationWorkspace .transfer-negotiation-grid');
  if (!grid) return null;
  let panel = document.getElementById('firstClassTransferHistoryPanel');
  if (!panel) {
    panel = document.createElement('article');
    panel.id = 'firstClassTransferHistoryPanel';
    panel.className = 'transfer-history-panel';
    panel.innerHTML = '<h3>Transfer history</h3><div id="firstClassTransferHistory"><p>Loading transfer history…</p></div>';
    grid.append(panel);
  }
  return document.getElementById('firstClassTransferHistory');
}

function statusPresentation(row) {
  switch (row.status) {
    case 'completed': return { label: 'Completed', detail: 'Applied to the canonical world.' };
    case 'application_failed': return { label: 'Application failed', detail: row.settlement_error || 'Canonical settlement validation failed.' };
    case 'declined': return { label: 'Declined', detail: 'The offer was declined.' };
    case 'withdrawn': return { label: 'Withdrawn', detail: 'The offer was withdrawn before agreement.' };
    case 'cancelled_in_grace': return { label: 'Cancelled in grace', detail: 'Cancelled during the mistake-grace period.' };
    case 'mutually_cancelled': return { label: 'Mutually cancelled', detail: 'Both clubs agreed to cancel the deal.' };
    case 'expired': return { label: 'Expired', detail: 'The deal expired before completion.' };
    case 'reneged': return { label: 'Reneged', detail: 'The binding deal was not completed.' };
    default: return { label: String(row.status || 'Closed').replaceAll('_', ' '), detail: row.terminal_reason || '' };
  }
}

function renderHistory(rows) {
  const host = historyHost();
  if (!host) return;
  if (!rows.length) {
    host.innerHTML = '<p>No completed or closed first-class transfers yet.</p>';
    return;
  }
  host.innerHTML = rows.map((row) => {
    const status = statusPresentation(row);
    const direction = row.direction === 'incoming' ? `From ${row.counterpart_club_name || row.counterpart_club_id}` : `To ${row.counterpart_club_name || row.counterpart_club_id}`;
    return `<article class="incoming-transfer-offer transfer-history-row">
      <div>
        <strong>${escapeHtml(row.player_name || row.player_id)}</strong>
        <span>${escapeHtml(direction)} · ${formatMoney(row.fee || 0)}</span>
        <small>Revision ${escapeHtml(row.revision_no || 1)} · ${escapeHtml(row.contract_years || 3)}-season contract · ${escapeHtml(formatDate(row.terminal_at || row.updated_at))}</small>
        ${status.detail ? `<small>${escapeHtml(status.detail)}</small>` : ''}
      </div>
      <div class="world-control-actions"><span class="world-control-status">${escapeHtml(status.label)}</span></div>
    </article>`;
  }).join('');
}

async function loadHistory({ force = false } = {}) {
  const host = historyHost();
  if (!host) return;
  if (!force && Date.now() - lastLoadedAt < TTL) return;
  if (loading) return loading;
  loading = (async () => {
    const token = storedAccessToken();
    if (!token) {
      host.innerHTML = '<p>Sign in to load transfer history.</p>';
      return;
    }
    const response = await fetch('/api/transfer-history', { headers: { authorization: `Bearer ${token}` } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Could not load transfer history');
    renderHistory(Array.isArray(data.history) ? data.history : []);
    lastLoadedAt = Date.now();
  })().catch((error) => {
    const current = historyHost();
    if (current) current.innerHTML = `<p>${escapeHtml(error.message)}</p>`;
  }).finally(() => { loading = null; });
  return loading;
}

function maybeMount(force = false) {
  if (!historyHost()) return;
  loadHistory({ force });
}

function scheduleHistoryMount(force = false) {
  setTimeout(() => maybeMount(force), 0);
}

document.addEventListener('click', (event) => {
  if (event.target.closest('[data-view="transfers"]')) scheduleHistoryMount(true);
});

document.addEventListener('tbg:view-changed', (event) => {
  if (event.detail?.view === 'transfers') scheduleHistoryMount(false);
});

window.addEventListener('tbg:portal-rendered', () => scheduleHistoryMount(false));

document.addEventListener('tbg:transfer-history-refresh', () => {
  lastLoadedAt = 0;
  scheduleHistoryMount(true);
});

maybeMount(false);
