const POSITION_ORDER = ['Goalkeeper', 'Centre-Back', 'Left-Back', 'Right-Back', 'Left Wing-Back', 'Right Wing-Back', 'Defensive Midfield', 'Central Midfield', 'Attacking Midfield', 'Left Winger', 'Right Winger', 'Second Striker', 'Centre-Forward', 'Unknown'];
const POSITION_ALIASES = new Map([
  ['gk', 'Goalkeeper'], ['goalkeeper', 'Goalkeeper'], ['cb', 'Centre-Back'], ['centre-back', 'Centre-Back'], ['center-back', 'Centre-Back'], ['central defender', 'Centre-Back'],
  ['lb', 'Left-Back'], ['left-back', 'Left-Back'], ['left back', 'Left-Back'], ['rb', 'Right-Back'], ['right-back', 'Right-Back'], ['right back', 'Right-Back'],
  ['lwb', 'Left Wing-Back'], ['left wing-back', 'Left Wing-Back'], ['rwb', 'Right Wing-Back'], ['right wing-back', 'Right Wing-Back'],
  ['dm', 'Defensive Midfield'], ['defensive midfield', 'Defensive Midfield'], ['defensive midfielder', 'Defensive Midfield'],
  ['cm', 'Central Midfield'], ['central midfield', 'Central Midfield'], ['central midfielder', 'Central Midfield'],
  ['am', 'Attacking Midfield'], ['attacking midfield', 'Attacking Midfield'], ['attacking midfielder', 'Attacking Midfield'],
  ['lw', 'Left Winger'], ['left winger', 'Left Winger'], ['left wing', 'Left Winger'], ['rw', 'Right Winger'], ['right winger', 'Right Winger'], ['right wing', 'Right Winger'],
  ['ss', 'Second Striker'], ['second striker', 'Second Striker'], ['cf', 'Centre-Forward'], ['st', 'Centre-Forward'], ['centre-forward', 'Centre-Forward'], ['center-forward', 'Centre-Forward'], ['striker', 'Centre-Forward']
]);

const COMMON_HEADERS = [
  ['#', 'squad_number'], ['Player', 'display_name'], ['Position', 'specific_position'], ['Age', 'age'], ['TBG', 'underlying_ability_rating']
];

const VIEWS = {
  general: {
    label: 'General',
    headers: [...COMMON_HEADERS,
      ['Fitness', 'fitness'], ['Morale', 'morale'], ['Availability', 'injury_status'], ['Contract', 'contract_expiry'], ['Status', 'transfer_listed']
    ]
  },
  statistics: {
    label: 'Statistics',
    headers: [...COMMON_HEADERS, ['Apps', 'stats_apps'], ['Goals', 'stats_goals'], ['Assists', 'stats_assists'], ['AvP', 'stats_avp'], ['Last 5', 'stats_recent']]
  },
  physical: {
    label: 'Physical',
    headers: [...COMMON_HEADERS, ['Fitness', 'fitness'], ['Morale', 'morale'], ['Availability', 'injury_status'], ['Squad status', 'squad_status'], ['Contract', 'contract_expiry']]
  },
  ability: {
    label: 'Ability',
    headers: [...COMMON_HEADERS, ['Previous', 'ability_previous'], ['Change', 'ability_delta'], ['Published', 'ability_published'], ['Latest state', 'ability_state'], ['History', 'ability_history']]
  },
  contracts: {
    label: 'Contracts',
    headers: [...COMMON_HEADERS, ['Contract', 'contract_expiry'], ['Transfer', 'transfer_state'], ['Loan', 'loan_state'], ['Availability', 'injury_status'], ['Squad status', 'squad_status']]
  }
};

let portalSnapshot = null;
let statisticsPromise = null;
let statisticsByPlayer = {};
let statisticsError = null;
let abilityPromise = null;
let abilityByPlayer = {};
let installed = false;
let renderTicket = 0;
const alternateSort = {
  statistics: { key: 'position_order', dir: 'asc' },
  physical: { key: 'position_order', dir: 'asc' },
  ability: { key: 'position_order', dir: 'asc' },
  contracts: { key: 'position_order', dir: 'asc' }
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}

const wholeNumber = (value, fallback = '—') => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number).toLocaleString('en-GB') : fallback;
};
const performanceRating = (value, fallback = '—') => {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(1) : fallback;
};

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

function playerId(player) { return player.tbg_player_id || player.player_id || ''; }
function playerName(player) { return player.display_name || player.player_name || player.canonical_name || playerId(player) || 'Unknown player'; }
function rating(player) { return player.underlying_ability_rating ?? player.tbg_rating ?? player.rating ?? '—'; }
function position(player) {
  const raw = player.specific_position || player.position || player.primary_position || player.position_group || 'Unknown';
  return POSITION_ALIASES.get(String(raw).trim().toLowerCase()) || raw;
}
function positionIndex(player) { const index = POSITION_ORDER.indexOf(position(player)); return index === -1 ? POSITION_ORDER.length : index; }
function isYouth(player) { return Boolean(player.youth_eligible_at_season_start ?? ((Number(player.season_start_age ?? player.age) || 99) <= 21)); }
function isLoanedOut(player) { return Boolean(player.loaned_out || String(player.loan_status || '').toLowerCase() === 'loaned_out'); }
function isAvailable(player) {
  const status = String(player.injury_status || player.availability || 'Available').toLowerCase();
  return !['injured', 'suspended', 'unavailable'].some((word) => status.includes(word));
}
function inRegistrationView(player, view) {
  if (view === 'full') return true;
  if (view === 'youth') return isYouth(player) && !isLoanedOut(player);
  if (view === 'loaned_out') return isLoanedOut(player);
  return !isYouth(player) && !isLoanedOut(player);
}

function playerLink(player) {
  const id = escapeHtml(playerId(player));
  const name = escapeHtml(playerName(player));
  const href = player.profile_url || player.pink_final_profile_url;
  return href
    ? `<a class="player-link" data-tbg-player-id="${id}" href="${escapeHtml(href)}">${name}</a>`
    : `<span class="player-link player-link-unavailable" data-tbg-player-id="${id}">${name}</span>`;
}

function formatDate(value) {
  if (!value) return 'Open-ended';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return escapeHtml(value);
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function contractValue(player) { return player.contract_expiry || player.contract_end_at || player.contract?.end_at || null; }
function availabilityValue(player) { return player.injury_status || player.availability || 'Available'; }
function transferValue(player) { return player.transfer_listed ? 'Transfer listed' : 'Not listed'; }
function loanValue(player) {
  if (isLoanedOut(player)) return player.loan_club_name ? `At ${player.loan_club_name}` : 'Loaned out';
  return player.loan_listed ? 'Loan listed' : 'Not listed';
}
function statusBadge(player) {
  const labels = [];
  if (player.transfer_listed) labels.push('Listed');
  if (player.loan_listed) labels.push('Loan list');
  if (isLoanedOut(player)) labels.push(player.loan_club_name ? `Loaned · ${player.loan_club_name}` : 'Loaned');
  return labels.length ? labels.join(' · ') : 'Squad player';
}

function currentView() { return document.getElementById('squadDataView')?.value || 'general'; }

function filteredPlayers() {
  const players = Array.isArray(portalSnapshot?.squad) ? portalSnapshot.squad : [];
  const registration = document.getElementById('registrationFilter')?.value || 'first_team';
  const query = String(document.getElementById('squadSearch')?.value || '').trim().toLowerCase();
  const wantedPosition = document.getElementById('positionFilter')?.value || 'all';
  const availability = document.getElementById('availabilityFilter')?.value || 'all';
  let rows = players.filter((player) => inRegistrationView(player, registration));
  if (query) rows = rows.filter((player) => `${playerName(player)} ${position(player)}`.toLowerCase().includes(query));
  if (wantedPosition !== 'all') rows = rows.filter((player) => position(player) === wantedPosition);
  if (availability === 'available') rows = rows.filter(isAvailable);
  if (availability === 'injured') rows = rows.filter((player) => !isAvailable(player));
  if (availability === 'listed') rows = rows.filter((player) => player.transfer_listed);
  if (availability === 'loan') rows = rows.filter((player) => player.loan_listed);
  return rows;
}

function recentAverage(player) {
  const recent = statisticsByPlayer[playerId(player)]?.recent_ratings;
  if (!Array.isArray(recent) || !recent.length) return null;
  const values = recent.map((row) => Number(row.rating)).filter(Number.isFinite);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function sortValue(player, key) {
  const stats = statisticsByPlayer[playerId(player)] || null;
  const ability = abilityByPlayer[playerId(player)] || {};
  const change = ability.latest_change || null;
  if (key === 'position_order') return positionIndex(player);
  if (key === 'squad_number') return Number(player.squad_number);
  if (key === 'display_name') return playerName(player);
  if (key === 'specific_position') return positionIndex(player);
  if (key === 'age') return Number(player.age);
  if (key === 'underlying_ability_rating') return Number(rating(player));
  if (key === 'fitness') return Number(player.fitness ?? 100);
  if (key === 'morale') return Number.isFinite(Number(player.morale)) ? Number(player.morale) : String(player.morale || 'Good');
  if (key === 'injury_status') return availabilityValue(player);
  if (key === 'contract_expiry') return contractValue(player) ? new Date(contractValue(player)).getTime() : null;
  if (key === 'squad_status') return statusBadge(player);
  if (key === 'transfer_state') return transferValue(player);
  if (key === 'loan_state') return loanValue(player);
  if (key === 'stats_apps') return stats?.appearances ?? null;
  if (key === 'stats_goals') return stats?.goals ?? null;
  if (key === 'stats_assists') return stats?.assists ?? null;
  if (key === 'stats_avp') return stats?.average_match_rating ?? null;
  if (key === 'stats_recent') return recentAverage(player);
  if (key === 'ability_previous') return change?.before ?? null;
  if (key === 'ability_delta') return change?.delta ?? null;
  if (key === 'ability_published') return change ? new Date(change.published_at || change.slot).getTime() : null;
  if (key === 'ability_state') return change?.after ?? rating(player);
  if (key === 'ability_history') return Array.isArray(ability.history) ? ability.history.length : 0;
  return player[key] ?? null;
}

function compareValues(a, b, dir) {
  const aMissing = a == null || (typeof a === 'number' && !Number.isFinite(a));
  const bMissing = b == null || (typeof b === 'number' && !Number.isFinite(b));
  if (aMissing || bMissing) {
    if (aMissing && bMissing) return 0;
    return aMissing ? 1 : -1;
  }
  const result = (typeof a === 'number' && typeof b === 'number')
    ? a - b
    : String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
  return dir === 'asc' ? result : -result;
}

function sortPlayers(rows, viewName) {
  const state = alternateSort[viewName] || { key: 'position_order', dir: 'asc' };
  return [...rows].sort((a, b) => {
    const result = compareValues(sortValue(a, state.key), sortValue(b, state.key), state.dir);
    if (result) return result;
    if (state.key !== 'underlying_ability_rating') {
      const ratingResult = compareValues(Number(rating(a)), Number(rating(b)), 'desc');
      if (ratingResult) return ratingResult;
    }
    return playerName(a).localeCompare(playerName(b), undefined, { sensitivity: 'base' });
  });
}

function updateHeaders(viewName) {
  const table = document.getElementById('squadTable');
  const headers = table?.querySelectorAll('thead th');
  const definition = VIEWS[viewName] || VIEWS.general;
  if (!headers || headers.length !== definition.headers.length) return;
  const state = alternateSort[viewName];
  headers.forEach((header, index) => {
    const [label, sortKey] = definition.headers[index];
    header.textContent = label;
    header.classList.toggle('active-sort', Boolean(state && sortKey === state.key));
    header.dataset.arrow = state && sortKey === state.key ? (state.dir === 'asc' ? '▲' : '▼') : '';
    if (sortKey) header.dataset.sort = sortKey;
    else delete header.dataset.sort;
  });
  table.classList.toggle('squad-data-view-active', viewName !== 'general');
}

function baseCells(player) {
  return `<td>${escapeHtml(player.squad_number ?? '—')}</td><td>${playerLink(player)}</td><td>${escapeHtml(position(player))}</td><td>${wholeNumber(player.age)}</td><td><strong>${wholeNumber(rating(player))}</strong></td>`;
}

function statisticsCells(player) {
  const stats = statisticsByPlayer[playerId(player)];
  if (!stats) return `${baseCells(player)}<td>—</td><td>—</td><td>—</td><td>—</td><td class="squad-recent-form">—</td>`;
  const average = stats.average_match_rating == null ? '—' : performanceRating(stats.average_match_rating);
  const recent = Array.isArray(stats.recent_ratings) && stats.recent_ratings.length
    ? stats.recent_ratings.map((row) => wholeNumber(row.rating)).join(' · ')
    : '—';
  return `${baseCells(player)}<td>${wholeNumber(stats.appearances, '0')}</td><td>${wholeNumber(stats.goals, '0')}</td><td>${wholeNumber(stats.assists, '0')}</td><td>${escapeHtml(average)}</td><td class="squad-recent-form">${escapeHtml(recent)}</td>`;
}

function physicalCells(player) {
  return `${baseCells(player)}<td>${wholeNumber(player.fitness ?? 100)}%</td><td>${wholeNumber(player.morale, escapeHtml(player.morale ?? 'Good'))}</td><td>${escapeHtml(availabilityValue(player))}</td><td>${escapeHtml(statusBadge(player))}</td><td>${formatDate(contractValue(player))}</td>`;
}

function abilityCells(player) {
  const record = abilityByPlayer[playerId(player)] || {};
  const change = record.latest_change || null;
  const delta = Number(change?.delta);
  const marker = !change ? '—' : delta > 0 ? `↑${wholeNumber(Math.abs(delta))}` : delta < 0 ? `↓${wholeNumber(Math.abs(delta))}` : '→0';
  const previous = change?.before == null ? '—' : wholeNumber(change.before);
  const published = change ? formatDate(change.published_at || change.slot) : '—';
  const state = change ? `${change.before == null ? '—' : wholeNumber(change.before)} → ${wholeNumber(change.after ?? rating(player))}` : 'No published change';
  const count = Array.isArray(record.history) ? record.history.length : 0;
  return `${baseCells(player)}<td>${escapeHtml(previous)}</td><td class="ability-delta">${escapeHtml(marker)}</td><td>${published}</td><td>${escapeHtml(state)}</td><td>${count ? `${count} update${count === 1 ? '' : 's'}` : '—'}</td>`;
}

function contractCells(player) {
  return `${baseCells(player)}<td>${formatDate(contractValue(player))}</td><td>${escapeHtml(transferValue(player))}</td><td>${escapeHtml(loanValue(player))}</td><td>${escapeHtml(availabilityValue(player))}</td><td>${escapeHtml(statusBadge(player))}</td>`;
}

function rowFor(player, viewName) {
  const cells = viewName === 'statistics' ? statisticsCells(player)
    : viewName === 'physical' ? physicalCells(player)
      : viewName === 'ability' ? abilityCells(player)
        : contractCells(player);
  return `<tr>${cells}</tr>`;
}

function renderRows(viewName) {
  const rows = sortPlayers(filteredPlayers(), viewName);
  const body = document.getElementById('squadRows');
  if (!body) return;
  const sortKey = alternateSort[viewName]?.key;
  const grouped = sortKey === 'position_order' || sortKey === 'specific_position';
  let previous = '';
  const html = rows.map((player) => {
    const group = position(player);
    const separator = grouped && group !== previous ? `<tr class="position-separator"><td colspan="10">${escapeHtml(group)}</td></tr>` : '';
    previous = group;
    return separator + rowFor(player, viewName);
  }).join('');
  body.innerHTML = html || '<tr><td colspan="10" class="empty-state">No players match this squad view and filter.</td></tr>';
  const count = document.getElementById('squadResultCount');
  const registration = document.getElementById('registrationFilter')?.selectedOptions?.[0]?.textContent || 'Squad';
  if (count) count.textContent = `${registration} · ${rows.length} players · ${VIEWS[viewName].label}`;
}

async function loadStatistics() {
  if (statisticsPromise) return statisticsPromise;
  const token = accessToken();
  const ids = (portalSnapshot?.squad || []).map(playerId).filter(Boolean);
  if (!ids.length) return {};
  if (!token) {
    statisticsError = new Error('Sign in again to load persisted season statistics.');
    throw statisticsError;
  }
  statisticsError = null;
  statisticsPromise = fetch('/api/squad-player-stats', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    cache: 'no-store',
    body: JSON.stringify({ player_ids: ids })
  }).then(async (response) => {
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Squad statistics request failed (HTTP ${response.status})`);
    statisticsByPlayer = payload.players || {};
    statisticsError = null;
    return statisticsByPlayer;
  }).catch((error) => {
    statisticsPromise = null;
    statisticsError = error;
    console.warn('Could not load squad statistics', error);
    throw error;
  });
  return statisticsPromise;
}

async function loadAbility() {
  if (abilityPromise) return abilityPromise;
  const token = accessToken();
  if (!token) return {};
  abilityPromise = fetch('/api/player-rating-history', { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' })
    .then(async (response) => {
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `Ability history request failed (HTTP ${response.status})`);
      abilityByPlayer = payload.players || {};
      return abilityByPlayer;
    }).catch((error) => {
      abilityPromise = null;
      console.warn('Could not load squad Ability history', error);
      return {};
    });
  return abilityPromise;
}

function statusMessage(text = '') {
  let node = document.getElementById('squadDataViewStatus');
  if (!node) {
    node = document.createElement('p');
    node.id = 'squadDataViewStatus';
    node.className = 'squad-data-view-status';
    document.querySelector('#squadView .squad-filters')?.after(node);
  }
  node.textContent = text;
  node.hidden = !text;
}

async function renderSelectedView() {
  const ticket = ++renderTicket;
  const viewName = currentView();
  updateHeaders(viewName);
  if (viewName === 'general') {
    statusMessage('');
    document.getElementById('registrationFilter')?.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }
  if (!portalSnapshot?.squad) {
    statusMessage('Loading squad data…');
    return;
  }
  let loadFailed = false;
  if (viewName === 'statistics') {
    statusMessage('Loading persisted season statistics…');
    renderRows(viewName);
    try { await loadStatistics(); } catch { loadFailed = true; }
  } else if (viewName === 'ability') {
    statusMessage('Loading governed Ability history…');
    await loadAbility();
  }
  if (ticket !== renderTicket || currentView() !== viewName) return;
  updateHeaders(viewName);
  renderRows(viewName);
  if (viewName === 'statistics' && (loadFailed || statisticsError)) {
    statusMessage(`Season statistics unavailable${statisticsError?.message ? ` · ${statisticsError.message}` : ''}`);
  } else statusMessage('');
}

function install() {
  if (installed) return;
  const filters = document.querySelector('#squadView .squad-filters');
  if (!filters || document.getElementById('squadDataView')) return;
  installed = true;
  if (!document.querySelector('link[href="./squad-player-statistics.css"]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = './squad-player-statistics.css';
    document.head.append(link);
  }
  const label = document.createElement('label');
  label.className = 'squad-data-view-control';
  label.innerHTML = `Display<select id="squadDataView">${Object.entries(VIEWS).map(([value, view]) => `<option value="${value}">${view.label}</option>`).join('')}</select>`;
  filters.prepend(label);
  label.querySelector('select').addEventListener('change', () => renderSelectedView().catch(() => {}));
  ['registrationFilter', 'squadSearch', 'positionFilter', 'availabilityFilter'].forEach((id) => {
    const control = document.getElementById(id);
    control?.addEventListener(id === 'squadSearch' ? 'input' : 'change', () => {
      if (currentView() === 'general') return;
      requestAnimationFrame(() => renderSelectedView().catch(() => {}));
    });
  });
  document.getElementById('squadTable')?.addEventListener('click', (event) => {
    if (currentView() === 'general') return;
    const header = event.target.closest('th[data-sort]');
    if (!header) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const viewName = currentView();
    const key = header.dataset.sort;
    const state = alternateSort[viewName];
    if (!state || !key) return;
    if (state.key === key) state.dir = state.dir === 'asc' ? 'desc' : 'asc';
    else {
      state.key = key;
      state.dir = ['display_name', 'specific_position', 'injury_status', 'squad_status', 'transfer_state', 'loan_state'].includes(key) ? 'asc' : 'desc';
    }
    renderSelectedView().catch(() => {});
  }, true);
}

window.addEventListener('tbg:portal-rendered', (event) => {
  portalSnapshot = event.detail || portalSnapshot;
  install();
  if (currentView() !== 'general') renderSelectedView().catch(() => {});
});

document.addEventListener('tbg:view-changed', (event) => {
  if (event.detail?.view !== 'squad') return;
  install();
  if (currentView() !== 'general') renderSelectedView().catch(() => {});
});

install();