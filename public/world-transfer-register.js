const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const formatMoney = (value) => `£${Math.max(0, Number(value) || 0).toLocaleString('en-GB')}`;
const formatDate = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' });
};
const REASONS = [
  ['suspected_collusion_multi_accounting', 'Suspected collusion or multi-accounting'],
  ['deliberate_club_wrecking', 'Deliberate club wrecking'],
  ['repeated_one_sided_dealing', 'Repeated one-sided dealing'],
  ['rules_circumvention', 'Circumvention of transfer rules'],
  ['other_competitive_integrity', 'Other competitive-integrity concern']
];

let lastLoadedAt = 0;
let loading = null;
const TTL = 60_000;

function storedAccessToken() {
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

function panelHost() {
  const grid = document.querySelector('#transferNegotiationWorkspace .transfer-negotiation-grid');
  if (!grid) return null;
  let panel = document.getElementById('worldTransferRegisterPanel');
  if (!panel) {
    panel = document.createElement('article');
    panel.id = 'worldTransferRegisterPanel';
    panel.className = 'transfer-history-panel world-transfer-register-panel';
    panel.innerHTML = `
      <h3>World transfers</h3>
      <p><small>Private negotiation, public agreement. Every deal below has been accepted through TBG's official transfer mechanism.</small></p>
      <div id="worldTransferRegister"><p>Loading accepted world transfers…</p></div>`;
    const history = document.getElementById('firstClassTransferHistoryPanel');
    if (history) history.before(panel);
    else grid.append(panel);
  }
  return document.getElementById('worldTransferRegister');
}

function statusPresentation(row) {
  if (row.effective_state === 'grace_period') return { label: 'Agreed · mistake grace', detail: `Becomes binding ${formatDate(row.binding_at || row.grace_expires_at)}.` };
  if (row.effective_state === 'binding') return { label: 'Binding · settlement pending', detail: `Settlement due ${formatDate(row.settle_at)}.` };
  switch (row.status) {
    case 'completed': return { label: 'Completed', detail: 'Applied to the canonical world.' };
    case 'application_failed': return { label: 'Application failed', detail: 'Accepted deal failed canonical settlement validation.' };
    case 'cancelled_in_grace': return { label: 'Cancelled in grace', detail: 'Accepted deal cancelled during the mistake-grace period.' };
    case 'mutually_cancelled': return { label: 'Mutually cancelled', detail: 'Accepted deal later cancelled by both clubs.' };
    case 'reneged': return { label: 'Reneged', detail: 'Binding agreement was not completed.' };
    default: return { label: String(row.status || 'Accepted').replaceAll('_', ' '), detail: row.terminal_reason || '' };
  }
}

function reportForm(row) {
  if (row.already_reported_by_me) return '<small class="world-control-status">Reported privately for review</small>';
  const options = REASONS.map(([value, label]) => `<option value="${value}">${escapeHtml(label)}</option>`).join('');
  return `<div class="world-transfer-report" hidden data-world-transfer-report-form="${escapeHtml(row.deal_id)}">
    <label>Reason <select data-world-transfer-report-reason>${options}</select></label>
    <label>Optional note <textarea rows="3" maxlength="2000" data-world-transfer-report-note placeholder="What makes this deal worth reviewing?"></textarea></label>
    <div class="world-control-actions">
      <button type="button" data-world-transfer-report-submit="${escapeHtml(row.deal_id)}">Send private report</button>
      <button type="button" data-world-transfer-report-cancel="${escapeHtml(row.deal_id)}">Cancel</button>
    </div>
    <small data-world-transfer-report-message></small>
  </div>`;
}

function renderDeal(row) {
  const status = statusPresentation(row);
  const playerLegs = (row.legs || []).filter((leg) => leg.leg_type === 'permanent_transfer');
  const cashLegs = (row.legs || []).filter((leg) => leg.leg_type === 'cash' && Number(leg.amount || 0) > 0);
  const players = playerLegs.map((leg) => `<div class="transfer-history-leg">
    <strong>${escapeHtml(leg.player_name || leg.player_id)}</strong>
    <span>${escapeHtml(leg.from_club_name || leg.from_club_id)} → ${escapeHtml(leg.to_club_name || leg.to_club_id)}</span>
    <small>${escapeHtml(leg.contract_years || 3)}-season contract</small>
  </div>`).join('');
  const cash = cashLegs.map((leg) => `<div class="transfer-history-cash"><strong>Cash</strong><span>${escapeHtml(leg.from_club_name || leg.from_club_id)} → ${escapeHtml(leg.to_club_name || leg.to_club_id)} · ${formatMoney(leg.amount)}</span></div>`).join('');
  const warning = row.integrity_level === 'warning'
    ? `<small><strong>Published integrity safeguard:</strong> ${escapeHtml(row.integrity_cooling_minutes || 15)}-minute cooling period${Array.isArray(row.integrity_reasons) && row.integrity_reasons.length ? ` · ${escapeHtml(row.integrity_reasons.map((reason) => reason.detail || reason.code).join(' '))}` : ''}</small>`
    : '';
  return `<article class="incoming-transfer-offer transfer-history-row transfer-history-package" data-world-transfer-deal="${escapeHtml(row.deal_id)}">
    <div>
      <strong>${playerLegs.length > 1 ? `${playerLegs.length}-player deal` : escapeHtml(playerLegs[0]?.player_name || 'Transfer package')}</strong>
      <small>Revision ${escapeHtml(row.revision_no || 1)} · accepted ${escapeHtml(formatDate(row.agreed_at))}</small>
      <div class="transfer-history-legs">${players}${cash}</div>
      ${warning}
      ${status.detail ? `<small>${escapeHtml(status.detail)}</small>` : ''}
      ${reportForm(row)}
    </div>
    <div class="world-control-actions">
      <span class="world-control-status">${escapeHtml(status.label)}</span>
      ${row.already_reported_by_me ? '' : `<button type="button" data-world-transfer-report-open="${escapeHtml(row.deal_id)}">Report transfer</button>`}
    </div>
  </article>`;
}

function renderRegister(rows) {
  const host = panelHost();
  if (!host) return;
  if (!rows.length) {
    host.innerHTML = '<p>No accepted first-class transfer agreements yet.</p>';
    return;
  }
  host.innerHTML = rows.map(renderDeal).join('');
}

async function api(body = null) {
  const token = storedAccessToken();
  if (!token) throw new Error('Sign in to view world transfers.');
  const response = await fetch('/api/world-transfers', {
    method: body ? 'POST' : 'GET',
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || data.message || 'World transfers request failed');
  return data;
}

async function loadRegister({ force = false } = {}) {
  const host = panelHost();
  if (!host) return;
  if (!force && Date.now() - lastLoadedAt < TTL) return;
  if (loading) return loading;
  loading = api().then((data) => {
    renderRegister(Array.isArray(data.transfers) ? data.transfers : []);
    lastLoadedAt = Date.now();
  }).catch((error) => {
    const current = panelHost();
    if (current) current.innerHTML = `<p>${escapeHtml(error.message)}</p>`;
  }).finally(() => { loading = null; });
  return loading;
}

async function submitReport(dealId, form) {
  const submit = form.querySelector('[data-world-transfer-report-submit]');
  const message = form.querySelector('[data-world-transfer-report-message]');
  const reason = form.querySelector('[data-world-transfer-report-reason]')?.value || '';
  const note = form.querySelector('[data-world-transfer-report-note]')?.value || '';
  if (submit) submit.disabled = true;
  if (message) message.textContent = 'Sending private integrity report…';
  try {
    const result = await api({ action: 'report', deal_id: dealId, reason, note });
    if (message) message.textContent = result.message || 'Transfer reported privately for review.';
    lastLoadedAt = 0;
    await loadRegister({ force: true });
  } catch (error) {
    if (message) message.textContent = error.message;
    if (submit) submit.disabled = false;
  }
}

function schedule(force = false) {
  setTimeout(() => {
    if (panelHost()) loadRegister({ force });
  }, 0);
}

document.addEventListener('click', (event) => {
  const open = event.target.closest('[data-world-transfer-report-open]');
  if (open) {
    const dealId = open.dataset.worldTransferReportOpen;
    const form = document.querySelector(`[data-world-transfer-report-form="${CSS.escape(dealId)}"]`);
    if (form) form.hidden = false;
    open.hidden = true;
    return;
  }
  const cancel = event.target.closest('[data-world-transfer-report-cancel]');
  if (cancel) {
    const dealId = cancel.dataset.worldTransferReportCancel;
    const form = document.querySelector(`[data-world-transfer-report-form="${CSS.escape(dealId)}"]`);
    const openButton = document.querySelector(`[data-world-transfer-report-open="${CSS.escape(dealId)}"]`);
    if (form) form.hidden = true;
    if (openButton) openButton.hidden = false;
    return;
  }
  const submit = event.target.closest('[data-world-transfer-report-submit]');
  if (submit) {
    const dealId = submit.dataset.worldTransferReportSubmit;
    const form = submit.closest('[data-world-transfer-report-form]');
    if (form) submitReport(dealId, form);
  }
});

document.addEventListener('tbg:view-changed', (event) => {
  if (event.detail?.view === 'transfers') schedule(false);
});
window.addEventListener('tbg:portal-rendered', () => schedule(false));
document.addEventListener('tbg:transfer-history-refresh', () => {
  lastLoadedAt = 0;
  schedule(true);
});

schedule(false);
