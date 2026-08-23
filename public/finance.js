const financeEscape = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const financeMoney = (value) => `£${Math.max(0, Number(value) || 0).toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

let financeLoadedAt = 0;
let financeLoading = null;
const FINANCE_TTL = 30_000;

function financeToken() {
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

function financeHost() {
  return document.getElementById('financeView');
}

function renderFinance(data) {
  const host = financeHost();
  if (!host) return;
  const finance = data?.finance || {};
  const headroom = Math.max(0, Number(finance.wage_headroom || 0));
  const budget = Math.max(0, Number(finance.wage_budget || 0));
  const bill = Math.max(0, Number(finance.wage_bill || 0));
  const utilisation = budget > 0 ? Math.min(100, Math.round((bill / budget) * 100)) : 0;
  host.innerHTML = `
    <section class="finance-shell">
      <div class="finance-heading">
        <div><h2>Club Finances</h2><p>Canonical alpha finances. Cash transfers and wage commitments are enforced against this live world state.</p></div>
        <span class="finance-status">Live</span>
      </div>
      <div class="finance-cards">
        <article class="finance-card"><span>Cash balance</span><strong>${financeMoney(finance.cash_balance)}</strong><small>Available for transfer cash commitments</small></article>
        <article class="finance-card"><span>Weekly wage bill</span><strong>${financeMoney(bill)}</strong><small>Active player contracts</small></article>
        <article class="finance-card"><span>Weekly wage budget</span><strong>${financeMoney(budget)}</strong><small>Current canonical ceiling</small></article>
        <article class="finance-card"><span>Wage headroom</span><strong>${financeMoney(headroom)}</strong><small>${utilisation}% of wage budget committed</small></article>
      </div>
      <article class="finance-detail-card">
        <div class="finance-detail-row"><span>Currency</span><strong>${financeEscape(finance.currency || 'GBP')}</strong></div>
        <div class="finance-detail-row"><span>World checkpoint</span><strong>${financeEscape(String(data?.source_checksum || '').slice(0, 12) || '—')}</strong></div>
        <div class="finance-detail-row"><span>Last canonical update</span><strong>${financeEscape(data?.updated_at ? new Date(data.updated_at).toLocaleString('en-GB') : '—')}</strong></div>
      </article>
      <p class="finance-note">This is the minimal pre-alpha finance spine. Sponsorship, gate receipts, prize money, facilities and longer-term club economy will be layered on later.</p>
    </section>`;
}

async function loadFinance({ force = false } = {}) {
  const host = financeHost();
  if (!host) return;
  if (!force && Date.now() - financeLoadedAt < FINANCE_TTL) return;
  if (financeLoading) return financeLoading;
  financeLoading = (async () => {
    const token = financeToken();
    if (!token) {
      host.innerHTML = '<div class="empty-state">Sign in to view club finances.</div>';
      return;
    }
    host.innerHTML = '<div class="empty-state">Loading canonical club finances…</div>';
    const response = await fetch('/api/club-finance', { headers: { authorization: `Bearer ${token}` } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Could not load club finances');
    renderFinance(data);
    financeLoadedAt = Date.now();
  })().catch((error) => {
    const current = financeHost();
    if (current) current.innerHTML = `<div class="empty-state">${financeEscape(error.message)}</div>`;
  }).finally(() => { financeLoading = null; });
  return financeLoading;
}

document.addEventListener('tbg:view-changed', (event) => {
  if (event.detail?.view === 'finance') loadFinance({ force: false });
});

window.addEventListener('tbg:portal-rendered', () => {
  if (document.getElementById('financeView')?.classList.contains('active')) loadFinance({ force: true });
});

export { loadFinance };
