const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));

function accessToken() {
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

function formatDate(value) {
  if (!value) return 'Date unavailable';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function formatMoney(value, currency = 'GBP') {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount) || amount <= 0) return 'Free';
  try {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: String(currency || 'GBP').toUpperCase(),
      maximumFractionDigits: 0
    }).format(amount);
  } catch {
    return `${String(currency || 'GBP').toUpperCase()} ${amount.toLocaleString('en-GB')}`;
  }
}

function typeLabel(event) {
  if (event.transfer_type === 'free_agent') return 'Free agent';
  if (event.transfer_type === 'external') return 'External signing';
  if (event.transfer_type === 'exchange') return 'Exchange';
  return 'Permanent transfer';
}

function clubLink(id, name) {
  const label = escapeHtml(name || id || 'Unknown club');
  return id ? `<button type="button" class="club-link transfer-profile-club-link" data-club-id="${escapeHtml(id)}">${label}</button>` : `<span>${label}</span>`;
}

function playerLink(id, name) {
  const label = escapeHtml(name || id || 'Unknown player');
  return id ? `<button type="button" class="player-link transfer-profile-player-link" data-player-profile-id="${escapeHtml(id)}">${label}</button>` : `<span>${label}</span>`;
}

function row(event, { showPlayer = false, perspectiveClubId = '' } = {}) {
  const direction = perspectiveClubId
    ? event.to_club_id === perspectiveClubId ? 'Arrival' : 'Departure'
    : typeLabel(event);
  const route = `${clubLink(event.from_club_id, event.from_club_name)} <span aria-hidden="true">→</span> ${clubLink(event.to_club_id, event.to_club_name)}`;
  const money = event.transfer_type === 'exchange' && event.package_player_count > 1
    ? `${formatMoney(event.fee, event.fee_currency)} package`
    : formatMoney(event.fee, event.fee_currency);
  return `<article class="tbg-profile-history-row transfer-profile-history-row">
    <span>${escapeHtml(formatDate(event.completed_at))}</span>
    <strong>${showPlayer ? `${playerLink(event.player_id, event.player_name)} · ` : ''}${escapeHtml(direction)} · ${escapeHtml(typeLabel(event))}</strong>
    <div class="transfer-profile-route">${route}</div>
    <b>${escapeHtml(money)}</b>
  </article>`;
}

function emptyState(title, body) {
  return `<div class="tbg-profile-empty"><strong>${escapeHtml(title)}</strong><p>${escapeHtml(body)}</p></div>`;
}

async function fetchHistory(params) {
  const token = accessToken();
  if (!token) throw new Error('Sign in again to load transfer history.');
  const query = new URLSearchParams(params);
  const response = await fetch(`/api/profile-transfer-history?${query.toString()}`, {
    headers: { authorization: `Bearer ${token}` },
    cache: 'no-store'
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Transfer history request failed (HTTP ${response.status})`);
  return Array.isArray(body.events) ? body.events : [];
}

function playerTransfersStillActive(panel) {
  if (!panel?.isConnected) return false;
  const host = panel.closest('[data-tbg-player-profile-host]');
  return host?.querySelector('[data-player-tab="transfers"]')?.getAttribute('aria-selected') === 'true';
}

async function mountPlayerTransferHistory(panel, playerId) {
  if (!panel || !playerId) return;
  panel.innerHTML = '<div class="tbg-profile-empty"><strong>Loading transfer history…</strong><p>Reading completed moves from the canonical TBG transfer ledger.</p></div>';
  try {
    const events = await fetchHistory({ player_id: playerId });
    if (!playerTransfersStillActive(panel)) return;
    panel.innerHTML = events.length
      ? `<div class="tbg-profile-history"><p class="tbg-profile-history-note">Completed TBG moves only. Private negotiations, failed applications and cancelled agreements are excluded.</p>${events.map((event) => row(event)).join('')}</div>`
      : emptyState('No completed TBG transfers yet', 'This player has no completed in-world transfer or acquisition recorded in the canonical ledger.');
  } catch (error) {
    if (!playerTransfersStillActive(panel)) return;
    panel.innerHTML = emptyState('Transfer history unavailable', error.message || 'Could not load transfer history.');
  }
}

export async function mountClubTransferHistory(panel, club = {}) {
  const clubId = String(club.club_id || club.id || '').trim();
  if (!panel || !clubId || panel.querySelector('[data-club-transfer-history]')) return;
  const section = document.createElement('section');
  section.dataset.clubTransferHistory = '';
  section.className = 'club-transfer-history';
  section.innerHTML = '<div class="section-heading"><div><p class="eyebrow">Transfer history</p><h3>Arrivals & departures</h3></div></div><div data-club-transfer-history-body><p>Loading completed moves…</p></div>';
  panel.append(section);
  const body = section.querySelector('[data-club-transfer-history-body]');
  try {
    const events = await fetchHistory({ club_id: clubId });
    if (!body?.isConnected) return;
    if (!events.length) {
      body.innerHTML = emptyState('No completed TBG transfers yet', 'This club has no completed arrivals or departures recorded in the canonical ledger.');
      return;
    }
    const arrivals = events.filter((event) => event.to_club_id === clubId);
    const departures = events.filter((event) => event.from_club_id === clubId);
    body.innerHTML = `<div class="tbg-profile-history"><p class="tbg-profile-history-note">${arrivals.length} arrival${arrivals.length === 1 ? '' : 's'} · ${departures.length} departure${departures.length === 1 ? '' : 's'}. Completed TBG moves only.</p>${events.map((event) => row(event, { showPlayer: true, perspectiveClubId: clubId })).join('')}</div>`;
  } catch (error) {
    if (!body?.isConnected) return;
    body.innerHTML = emptyState('Transfer history unavailable', error.message || 'Could not load club transfer history.');
  }
}

document.addEventListener('click', (event) => {
  const clubButton = event.target.closest('.transfer-profile-club-link');
  const playerModal = clubButton?.closest('[data-tbg-player-profile-host]');
  if (playerModal) playerModal.remove();
}, true);

document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-player-tab="transfers"]');
  if (!button) return;
  const host = button.closest('[data-tbg-player-profile-host]');
  const panel = host?.querySelector('[data-player-tab-panel]');
  const playerId = host?.querySelector('[data-player-id]')?.dataset.playerId;
  queueMicrotask(() => mountPlayerTransferHistory(panel, playerId));
});

export { formatMoney, typeLabel, row };