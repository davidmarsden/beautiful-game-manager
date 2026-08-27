if (!document.querySelector('link[href="./rating-history.css"]')) {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = './rating-history.css';
  document.head.append(link);
}

let historyPromise = null;
let historyByPlayer = {};

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

async function loadHistory() {
  if (historyPromise) return historyPromise;
  const token = accessToken();
  if (!token) return {};
  historyPromise = fetch('/api/player-rating-history', { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' })
    .then(async (response) => {
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `Rating history request failed (HTTP ${response.status})`);
      historyByPlayer = payload.players || {};
      return historyByPlayer;
    })
    .catch((error) => { historyPromise = null; console.warn('Could not load governed Ability history', error); return {}; });
  return historyPromise;
}

function playerIdFromLink(link, squadByName) {
  const explicit = link.dataset.tbgPlayerId || link.dataset.playerId;
  if (explicit) return explicit;
  const named = squadByName.get(link.textContent.trim().toLowerCase());
  if (named) return named;
  try {
    const id = new URL(link.href, location.href).searchParams.get('id');
    if (id?.startsWith('tbg-')) return id;
  } catch {}
  return '';
}

function changeBadge(change) {
  if (!change) return null;
  const delta = Number(change.delta);
  const marker = delta > 0 ? `↑${Math.abs(delta)}` : delta < 0 ? `↓${Math.abs(delta)}` : '→0';
  const date = new Date(change.published_at || change.slot);
  const when = Number.isNaN(date.getTime()) ? String(change.slot || '') : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const badge = document.createElement('span');
  badge.className = `ability-change ${delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat'}`;
  badge.title = `${String(change.before ?? '—')} → ${String(change.after ?? '—')} · ${when}`;
  badge.textContent = marker;
  return badge;
}

function decorateSquadRows(squad = [], scope = document) {
  const squadByName = new Map(squad.map((player) => [String(player.display_name || player.player_name || player.canonical_name || '').trim().toLowerCase(), player.tbg_player_id || player.player_id || '']));
  scope.querySelectorAll('#squadRows tr, [data-squad-rows] tr').forEach((row) => {
    if (row.classList.contains('position-separator')) return;
    const link = row.querySelector('.player-link');
    const cells = row.querySelectorAll('td');
    if (!link || cells.length < 5) return;
    const playerId = playerIdFromLink(link, squadByName);
    if (playerId) link.dataset.tbgPlayerId = playerId;
    const change = historyByPlayer[playerId]?.latest_change;
    cells[4].querySelector('.ability-change')?.remove();
    const badge = changeBadge(change);
    if (badge) {
      cells[4].append(document.createTextNode(' '));
      cells[4].append(badge);
    }
  });
}

async function refresh(detail = {}) {
  await loadHistory();
  const scope = detail.root instanceof Element ? detail.root : document;
  requestAnimationFrame(() => decorateSquadRows(detail.squad || detail.players || [], scope));
}

window.addEventListener('tbg:portal-rendered', (event) => {
  if (document.getElementById('squadView')?.classList.contains('active')) refresh(event.detail || {});
});
window.addEventListener('tbg:read-only-squad-rendered', (event) => refresh(event.detail || {}));
document.addEventListener('tbg:view-changed', (event) => {
  if (event.detail?.view === 'squad') refresh().catch(() => {});
});

['registrationFilter', 'squadSearch', 'positionFilter', 'availabilityFilter'].forEach((id) => {
  document.getElementById(id)?.addEventListener(id === 'squadSearch' ? 'input' : 'change', () => requestAnimationFrame(() => decorateSquadRows()));
});
document.getElementById('squadTable')?.addEventListener('click', (event) => {
  if (event.target.closest('th[data-sort]')) requestAnimationFrame(() => decorateSquadRows());
});

document.addEventListener('input', (event) => {
  if (event.target.matches('[data-squad-search]')) requestAnimationFrame(() => decorateSquadRows());
});
document.addEventListener('change', (event) => {
  if (event.target.matches('[data-squad-view], [data-position-filter], [data-availability-filter]')) requestAnimationFrame(() => decorateSquadRows());
});
