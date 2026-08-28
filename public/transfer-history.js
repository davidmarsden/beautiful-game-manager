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

function requestedDealId() {
  return new URLSearchParams(window.location.search).get('deal') || '';
}

function focusRequestedDeal() {
  const dealId = requestedDealId();
  if (!dealId) return false;
  const selectorId = window.CSS?.escape ? window.CSS.escape(dealId) : dealId.replace(/(["\\])/g, '\\$1');
  const target = document.querySelector(`[data-first-class-deal="${selectorId}"], [data-transfer-history-deal="${selectorId}"]`);
  if (!target || target.dataset.notificationTargetFocused === 'true') return Boolean(target);
  target.dataset.notificationTargetFocused = 'true';
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  target.style.outline = '2px solid currentColor';
  target.style.outlineOffset = '3px';
  window.setTimeout(() => {
    target.style.outline = '';
    target.style.outlineOffset = '';
  }, 4000);
  return true;
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

function groupHistory(rows) {
  const result = [];
  const deals = new Map();
  for (const row of rows) {
    if (!row?.deal_id || !Array.isArray(row.legs) || !row.legs.length) {
      result.push(row);
      continue;
    }
    if (deals.has(row.deal_id)) continue;
    deals.set(row.deal_id, true);
    result.push({ ...row, package_deal: true });
  }
  return result;
}

function renderPackageDeal(row, status) {
  const playerLegs = row.legs.filter((leg) => leg.leg_type === 'permanent_transfer');
  const cashLegs = row.legs.filter((leg) => leg.leg_type === 'cash' && Number(leg.amount || 0) > 0);
  const players = playerLegs.map((leg) => `<div class="transfer-history-leg">
    <strong>${escapeHtml(leg.player_name || leg.player_id)}</strong>
    <span>${escapeHtml(leg.from_club_name || leg.from_club_id)} → ${escapeHtml(leg.to_club_name || leg.to_club_id)}</span>
    <small>${escapeHtml(leg.contract_years || 3)}-season contract</small>
  </div>`).join('');
  const cash = cashLegs.map((leg) => `<div class="transfer-history-cash"><strong>Cash</strong><span>${escapeHtml(leg.from_club_name || leg.from_club_id)} → ${escapeHtml(leg.to_club_name || leg.to_club_id)} · ${formatMoney(leg.amount)}</span></div>`).join('');
  return `<article class="incoming-transfer-offer transfer-history-row transfer-history-package" data-transfer-history-deal="${escapeHtml(row.deal_id || '')}">
    <div>
      <strong>${playerLegs.length > 1 ? `${playerLegs.length}-player deal` : escapeHtml(playerLegs[0]?.player_name || row.player_name || row.player_id)}</strong>
      <small>Revision ${escapeHtml(row.revision_no || 1)} · ${escapeHtml(formatDate(row.terminal_at || row.updated_at))}</small>
      <div class="transfer-history-legs">${players}${cash}</div>
      ${status.detail ? `<small>${escapeHtml(status.detail)}</small>` : ''}
    </div>
    <div class="world-control-actions"><span class="world-control-status">${escapeHtml(status.label)}</span></div>
  </article>`;
}

function renderLegacyRow(row, status) {
  const direction = row.direction === 'incoming' ? `From ${row.counterpart_club_name || row.counterpart_club_id}` : `To ${row.counterpart_club_name || row.counterpart_club_id}`;
  return `<article class="incoming-transfer-offer transfer-history-row" data-transfer-history-deal="${escapeHtml(row.deal_id || '')}">
    <div>
      <strong>${escapeHtml(row.player_name || row.player_id)}</strong>
      <span>${escapeHtml(direction)} · ${formatMoney(row.fee || 0)}</span>
      <small>Revision ${escapeHtml(row.revision_no || 1)} · ${escapeHtml(row.contract_years || 3)}-season contract · ${escapeHtml(formatDate(row.terminal_at || row.updated_at))}</small>
      ${status.detail ? `<small>${escapeHtml(status.detail)}</small>` : ''}
    </div>
    <div class="world-control-actions"><span class="world-control-status">${escapeHtml(status.label)}</span></div>
  </article>`;
}

function renderHistory(rows) {
  const host = historyHost();
  if (!host) return;
  if (!rows.length) {
    host.innerHTML = '<p>No completed or closed first-class transfers yet.</p>';
    focusRequestedDeal();
    return;
  }
  host.innerHTML = groupHistory(rows).map((row) => {
    const status = statusPresentation(row);
    return row.package_deal ? renderPackageDeal(row, status) : renderLegacyRow(row, status);
  }).join('');
  focusRequestedDeal();
}

async function loadHistory({ force = false } = {}) {
  const host = historyHost();
  if (!host) return;
  if (focusRequestedDeal()) return;
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
  if (focusRequestedDeal()) return;
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

window.addEventListener('tbg:portal-rendered', () => {
  if (document.getElementById('transfersView')?.classList.contains('active')) scheduleHistoryMount(false);
});

document.addEventListener('tbg:transfer-history-refresh', () => {
  lastLoadedAt = 0;
  setTimeout(() => maybeMount(true), 0);
});