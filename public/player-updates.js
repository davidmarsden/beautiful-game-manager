const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const moneyEur = (value) => value == null || value === '' ? '—' : `€${Math.max(0, Number(value) || 0).toLocaleString('en-GB')}`;

let loaded = false;
let loading = false;
let lastPayload = null;

function authToken() {
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

function installStyles() {
  if (document.getElementById('tbgPlayerUpdatesStyles')) return;
  const style = document.createElement('style');
  style.id = 'tbgPlayerUpdatesStyles';
  style.textContent = `
    .player-updates-shell{display:grid;gap:1rem}.player-updates-hero{display:flex;gap:1rem;justify-content:space-between;align-items:flex-start;padding:1rem;border:1px solid var(--border,#d9d9d9);border-radius:14px;background:var(--panel,#fff)}
    .player-updates-hero h2{margin:0 0 .35rem}.player-updates-hero p{margin:0;max-width:70ch}.player-updates-meta{display:flex;gap:.45rem;flex-wrap:wrap;justify-content:flex-end}.player-updates-pill{display:inline-flex;padding:.3rem .6rem;border-radius:999px;background:rgba(127,127,127,.12);font-size:.82rem;white-space:nowrap}
    .player-updates-section{border:1px solid var(--border,#d9d9d9);border-radius:14px;background:var(--panel,#fff);overflow:hidden}.player-updates-section>header{display:flex;gap:1rem;justify-content:space-between;align-items:end;padding:1rem;border-bottom:1px solid var(--border,#e2e2e2)}.player-updates-section h3{margin:0}.player-updates-section p{margin:.2rem 0 0}
    .player-update-list{display:grid}.player-update-card{display:grid;grid-template-columns:minmax(180px,1fr) auto;gap:1rem;padding:1rem;border-top:1px solid var(--border,#ececec)}.player-update-card:first-child{border-top:0}.player-update-name{font-weight:750}.player-update-sub{font-size:.9rem;opacity:.78;margin-top:.15rem}.player-update-ratings{display:flex;gap:.5rem;align-items:center;justify-content:flex-end}.player-update-rating{font-size:1.15rem;font-weight:800;min-width:2.4rem;text-align:center}.player-update-arrow{opacity:.55}.player-update-delta{font-weight:800}.player-update-delta.up{color:#187a37}.player-update-delta.down{color:#a42b2b}.player-update-delta.flat{opacity:.65}.player-update-new{font-size:1.15rem;font-weight:800}.player-update-empty{padding:1rem;opacity:.75}
    .player-update-provenance{grid-column:1/-1;margin-top:.15rem}.player-update-provenance summary{cursor:pointer;font-size:.84rem;opacity:.8}.player-update-provenance dl{display:grid;grid-template-columns:max-content 1fr;gap:.25rem .7rem;margin:.6rem 0 0;font-size:.82rem}.player-update-provenance dt{font-weight:700}.player-update-provenance dd{margin:0;overflow-wrap:anywhere}
    @media(max-width:720px){.player-updates-hero{flex-direction:column}.player-updates-meta{justify-content:flex-start}.player-update-card{grid-template-columns:1fr}.player-update-ratings{justify-content:flex-start}.player-updates-section>header{align-items:flex-start;flex-direction:column}}
  `;
  document.head.append(style);
}

function formatDate(value) {
  if (!value) return 'Unpublished';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function provenance(event) {
  const p = event?.provenance || {};
  const rows = [
    ['Transfermarkt ID', event?.transfermarkt_id || '—'],
    ['Source', p.source || '—'],
    ['Source snapshot', p.source_scraped_at ? formatDate(p.source_scraped_at) : '—'],
    ['Market value date', p.market_value_determined || '—'],
    ['Rating model', p.rating_model_version || '—'],
    ['Database edition', p.player_database_edition_generated_at ? formatDate(p.player_database_edition_generated_at) : '—']
  ];
  return `<details class="player-update-provenance"><summary>Source & provenance</summary><dl>${rows.map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`).join('')}</dl></details>`;
}

function ratingCard(event) {
  const before = event.before ?? '—';
  const after = event.after ?? '—';
  const delta = Number(event.delta ?? (Number(after) - Number(before)));
  const deltaClass = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
  const deltaText = Number.isFinite(delta) ? `${delta > 0 ? '+' : ''}${delta}` : '—';
  return `<article class="player-update-card">
    <div><div class="player-update-name">${escapeHtml(event.player_name || event.player_id || 'Player')}</div><div class="player-update-sub">TM ${escapeHtml(event.transfermarkt_id || '—')}</div></div>
    <div class="player-update-ratings" aria-label="Rating changed from ${escapeHtml(before)} to ${escapeHtml(after)}"><span class="player-update-rating">${escapeHtml(before)}</span><span class="player-update-arrow">→</span><span class="player-update-rating">${escapeHtml(after)}</span><span class="player-update-delta ${deltaClass}">${escapeHtml(deltaText)}</span></div>
    ${provenance(event)}
  </article>`;
}

function newPlayerCard(event) {
  const after = event.after && typeof event.after === 'object' ? event.after : {};
  const details = [
    after.current_club || '',
    after.tbg_rating != null ? `Rating ${after.tbg_rating}` : '',
    after.market_value_eur != null ? `TM value ${moneyEur(after.market_value_eur)}` : ''
  ].filter(Boolean).join(' · ');
  return `<article class="player-update-card">
    <div><div class="player-update-name">${escapeHtml(event.player_name || event.player_id || 'New player')}</div><div class="player-update-sub">${escapeHtml(details || `TM ${event.transfermarkt_id || '—'}`)}</div></div>
    <div class="player-update-new">NEW</div>
    ${provenance(event)}
  </article>`;
}

function section(title, description, events, renderer) {
  return `<section class="player-updates-section"><header><div><h3>${escapeHtml(title)}</h3><p>${escapeHtml(description)}</p></div><span class="player-updates-pill">${events.length}</span></header><div class="player-update-list">${events.length ? events.map(renderer).join('') : '<div class="player-update-empty">Nothing in this release.</div>'}</div></section>`;
}

function render(payload) {
  const host = document.getElementById('playerUpdatesView');
  if (!host) return;
  installStyles();
  const release = payload?.release || null;
  const ratings = Array.isArray(payload?.ratings_updates) ? payload.ratings_updates : [];
  const newPlayers = Array.isArray(payload?.new_players) ? payload.new_players : [];
  const pending = Number(payload?.pending_eligible || 0);
  if (!release) {
    host.innerHTML = `<div class="player-updates-shell"><section class="player-updates-hero"><div><h2>Player Updates</h2><p>No governed ratings/new-player release has been published yet. Updates will appear here exactly as released by the TBG player-data pipeline.</p></div><div class="player-updates-meta"><span class="player-updates-pill">${pending} pending</span></div></section></div>`;
    return;
  }
  host.innerHTML = `<div class="player-updates-shell">
    <section class="player-updates-hero"><div><h2>Player Updates</h2><p>Governed Transfermarkt-backed changes published to the TBG world. Manager does not recalculate these ratings.</p></div><div class="player-updates-meta"><span class="player-updates-pill">${escapeHtml(release.slot || 'Latest')}</span><span class="player-updates-pill">${escapeHtml(formatDate(release.published_at))}</span><span class="player-updates-pill">${pending} pending</span></div></section>
    ${section('Ratings Updates', 'Latest published TBG ability changes.', ratings, ratingCard)}
    ${section('New Players', 'Newly published players entering the governed TBG universe.', newPlayers, newPlayerCard)}
  </div>`;
}

async function loadUpdates({ force = false } = {}) {
  if (loading || (loaded && !force)) return;
  const host = document.getElementById('playerUpdatesView');
  if (!host) return;
  const token = authToken();
  if (!token) {
    host.innerHTML = '<div class="empty-state">Sign in to view player updates.</div>';
    return;
  }
  loading = true;
  host.innerHTML = '<div class="empty-state">Loading governed player updates…</div>';
  try {
    const response = await fetch('/api/player-updates', { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Player updates request failed (HTTP ${response.status})`);
    lastPayload = payload;
    loaded = true;
    render(payload);
  } catch (error) {
    host.innerHTML = `<div class="empty-state">${escapeHtml(error.message || 'Unable to load player updates.')}</div>`;
  } finally {
    loading = false;
  }
}

function maybeLoad(event) {
  const view = event?.detail?.view || '';
  if (view === 'updates') loadUpdates().catch(() => {});
}

document.addEventListener('tbg:view-changed', maybeLoad);
window.addEventListener('tbg:portal-rendered', () => {
  if (document.getElementById('playerUpdatesView')?.classList.contains('active')) loadUpdates().catch(() => {});
});
document.addEventListener('tbg:player-updates-refresh', () => loadUpdates({ force: true }).catch(() => {}));

export { loadUpdates, render, ratingCard, newPlayerCard };
