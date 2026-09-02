const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));

export const POSITION_ORDER = ['Goalkeeper', 'Centre-Back', 'Left-Back', 'Right-Back', 'Left Wing-Back', 'Right Wing-Back', 'Defensive Midfield', 'Central Midfield', 'Attacking Midfield', 'Left Winger', 'Right Winger', 'Second Striker', 'Centre-Forward', 'Unknown'];
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

const DATA_VIEWS = {
  general: {
    label: 'General',
    headers: [['#', 'squad_number'], ['Player', 'name'], ['Position', 'position'], ['Age', 'age'], ['TBG', 'tbg'], ['Fitness', 'fitness'], ['Morale', 'morale'], ['Availability', 'availability'], ['Contract', 'contract'], ['Status', 'status']]
  },
  statistics: {
    label: 'Statistics',
    headers: [['#', 'squad_number'], ['Player', 'name'], ['Position', 'position'], ['Age', 'age'], ['TBG', 'tbg'], ['Apps', 'apps'], ['Goals', 'goals'], ['Assists', 'assists'], ['AvP', 'avp'], ['Last 5', 'last5']]
  },
  physical: {
    label: 'Physical',
    headers: [['#', 'squad_number'], ['Player', 'name'], ['Position', 'position'], ['Age', 'age'], ['TBG', 'tbg'], ['Fitness', 'fitness'], ['Morale', 'morale'], ['Availability', 'availability'], ['Squad status', 'status'], ['Contract', 'contract']]
  },
  ability: {
    label: 'Ability',
    headers: [['#', 'squad_number'], ['Player', 'name'], ['Position', 'position'], ['Age', 'age'], ['TBG', 'tbg'], ['Previous', 'previous'], ['Change', 'change'], ['Published', 'published'], ['Latest state', 'latest_state'], ['History', 'history']]
  },
  contracts: {
    label: 'Contracts',
    headers: [['#', 'squad_number'], ['Player', 'name'], ['Position', 'position'], ['Age', 'age'], ['TBG', 'tbg'], ['Contract', 'contract'], ['Transfer', 'transfer'], ['Loan', 'loan'], ['Availability', 'availability'], ['Squad status', 'status']]
  }
};

const statisticsCache = new Map();
let abilityPromise = null;
let abilityByPlayer = {};

export const playerName = (player) => player.display_name || player.player_name || player.canonical_name || player.tbg_player_id || player.player_id || 'Unknown player';
export const playerRating = (player) => player.underlying_ability_rating ?? player.tbg_rating ?? player.rating ?? null;
export const canonicalPosition = (player) => {
  const raw = player.specific_position || player.position || player.primary_position || player.position_group || 'Unknown';
  return POSITION_ALIASES.get(String(raw).trim().toLowerCase()) || raw || 'Unknown';
};
export const isYouthPlayer = (player) => Boolean(player.youth_eligible_at_season_start ?? ((Number(player.season_start_age ?? player.age) || 99) <= 21));
export const isLoanedOutPlayer = (player) => Boolean(player.loaned_out || String(player.loan_status || '').toLowerCase() === 'loaned_out');

const playerId = (player) => player.tbg_player_id || player.player_id || '';
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

function isAvailable(player) {
  const status = String(player.injury_status || player.availability || 'Available').toLowerCase();
  return !['injured', 'suspended', 'unavailable'].some((word) => status.includes(word));
}

function registrationView(player, view) {
  if (view === 'full') return true;
  if (view === 'youth') return isYouthPlayer(player) && !isLoanedOutPlayer(player);
  if (view === 'loaned_out') return isLoanedOutPlayer(player);
  return !isYouthPlayer(player) && !isLoanedOutPlayer(player);
}

function statusText(player) {
  const labels = [];
  if (player.transfer_listed) labels.push('Listed');
  if (player.loan_listed) labels.push('Loan list');
  if (isLoanedOutPlayer(player)) labels.push(player.loan_club_name ? `Loaned · ${player.loan_club_name}` : 'Loaned');
  if (!player.registered && !isYouthPlayer(player) && !isLoanedOutPlayer(player)) labels.push('Unregistered');
  return labels.join(' · ') || 'Squad player';
}

function statusBadges(player) {
  const badges = [];
  if (player.transfer_listed) badges.push('<span class="badge transfer">Listed</span>');
  if (player.loan_listed) badges.push('<span class="badge loan">Loan list</span>');
  if (isLoanedOutPlayer(player)) badges.push(`<span class="badge loaned">Loaned${player.loan_club_name ? ` · ${escapeHtml(player.loan_club_name)}` : ''}</span>`);
  if (!player.registered && !isYouthPlayer(player) && !isLoanedOutPlayer(player)) badges.push('<span class="badge neutral">Unregistered</span>');
  return badges.join(' ') || '<span class="badge neutral">Squad player</span>';
}

function availabilityLabel(player) { return player.injury_status || player.availability || 'Available'; }
function availabilityBadge(player) { return `<span class="badge ${isAvailable(player) ? 'fit' : 'injured'}">${escapeHtml(availabilityLabel(player))}</span>`; }
function contractValue(player) { return player.contract_expiry || player.contract_end_at || player.contract?.end_at || ''; }
function contractLabel(player) { return formatDate(contractValue(player), 'Open-ended'); }

function playerNameMarkup(player) {
  const name = escapeHtml(playerName(player));
  const id = escapeHtml(playerId(player));
  if (!player.profile_url) return `<span class="player-link player-link-unavailable" data-tbg-player-id="${id}" title="Pink Final profile not published yet">${name}</span>`;
  return `<a class="player-link" data-tbg-player-id="${id}" href="${escapeHtml(player.profile_url)}" target="_blank" rel="noopener">${name}</a>`;
}

function formatDate(value, fallback = '—') {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return escapeHtml(value);
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function recentAverage(stats) {
  const ratings = Array.isArray(stats?.recent_ratings) ? stats.recent_ratings.map((row) => Number(row.rating)).filter(Number.isFinite) : [];
  return ratings.length ? ratings.reduce((sum, value) => sum + value, 0) / ratings.length : null;
}

async function loadStatistics(players, worldId) {
  const missing = players.map(playerId).filter(Boolean).filter((id) => !statisticsCache.has(id));
  if (!missing.length) return;
  const token = accessToken();
  if (!token) throw new Error('Sign in again to load persisted season statistics.');
  const response = await fetch('/api/squad-player-stats', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    cache: 'no-store',
    body: JSON.stringify({ world_id: worldId || 'tbg-world-1', player_ids: missing })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Squad statistics request failed (HTTP ${response.status})`);
  for (const [id, stats] of Object.entries(payload.players || {})) statisticsCache.set(id, stats);
}

async function loadAbility() {
  if (abilityPromise) return abilityPromise;
  const token = accessToken();
  if (!token) throw new Error('Sign in again to load governed Ability history.');
  abilityPromise = fetch('/api/player-rating-history', { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' })
    .then(async (response) => {
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `Ability history request failed (HTTP ${response.status})`);
      abilityByPlayer = payload.players || {};
      return abilityByPlayer;
    })
    .catch((error) => { abilityPromise = null; throw error; });
  return abilityPromise;
}

function generalCells(player) {
  return `<td>${player.squad_number ?? '—'}</td><td>${playerNameMarkup(player)}</td><td>${escapeHtml(canonicalPosition(player))}</td><td>${wholeNumber(player.age)}</td><td><strong>${wholeNumber(playerRating(player))}</strong></td><td>${wholeNumber(player.fitness ?? 100)}%</td><td>${wholeNumber(player.morale, escapeHtml(player.morale || 'Good'))}</td><td>${availabilityBadge(player)}</td><td>${contractLabel(player)}</td><td>${statusBadges(player)}</td>`;
}

function baseCells(player) {
  return `<td>${player.squad_number ?? '—'}</td><td>${playerNameMarkup(player)}</td><td>${escapeHtml(canonicalPosition(player))}</td><td>${wholeNumber(player.age)}</td><td><strong>${wholeNumber(playerRating(player))}</strong></td>`;
}

function statisticsCells(player, statisticsUnavailable) {
  const stats = statisticsCache.get(playerId(player));
  if (!stats || statisticsUnavailable) return `${baseCells(player)}<td>—</td><td>—</td><td>—</td><td>—</td><td>—</td>`;
  const recent = Array.isArray(stats.recent_ratings) && stats.recent_ratings.length ? stats.recent_ratings.map((row) => performanceRating(row.rating)).join(' · ') : '—';
  const average = stats.average_match_rating == null ? '—' : performanceRating(stats.average_match_rating);
  return `${baseCells(player)}<td>${wholeNumber(stats.appearances, '0')}</td><td>${wholeNumber(stats.goals, '0')}</td><td>${wholeNumber(stats.assists, '0')}</td><td>${escapeHtml(average)}</td><td class="squad-recent-form">${escapeHtml(recent)}</td>`;
}

function physicalCells(player) {
  return `${baseCells(player)}<td>${wholeNumber(player.fitness ?? 100)}%</td><td>${wholeNumber(player.morale, escapeHtml(player.morale || 'Good'))}</td><td>${availabilityBadge(player)}</td><td>${statusBadges(player)}</td><td>${contractLabel(player)}</td>`;
}

function abilityCells(player) {
  const record = abilityByPlayer[playerId(player)] || {};
  const change = record.latest_change || null;
  const delta = Number(change?.delta);
  const marker = !change ? '—' : delta > 0 ? `↑${wholeNumber(Math.abs(delta))}` : delta < 0 ? `↓${wholeNumber(Math.abs(delta))}` : '→0';
  const previous = change?.before == null ? '—' : wholeNumber(change.before);
  const published = change ? formatDate(change.published_at || change.slot) : '—';
  const state = change ? `${change.before == null ? '—' : wholeNumber(change.before)} → ${wholeNumber(change.after ?? playerRating(player))}` : 'No published change';
  const count = Array.isArray(record.history) ? record.history.length : 0;
  return `${baseCells(player)}<td>${escapeHtml(previous)}</td><td>${escapeHtml(marker)}</td><td>${published}</td><td>${escapeHtml(state)}</td><td>${count ? `${count} update${count === 1 ? '' : 's'}` : '—'}</td>`;
}

function contractCells(player) {
  const transfer = player.transfer_listed ? 'Transfer listed' : 'Not listed';
  const loan = isLoanedOutPlayer(player) ? (player.loan_club_name ? `At ${player.loan_club_name}` : 'Loaned out') : player.loan_listed ? 'Loan listed' : 'Not listed';
  return `${baseCells(player)}<td>${contractLabel(player)}</td><td>${escapeHtml(transfer)}</td><td>${escapeHtml(loan)}</td><td>${availabilityBadge(player)}</td><td>${statusBadges(player)}</td>`;
}

function rowCells(player, view, statisticsUnavailable) {
  if (view === 'general') return generalCells(player);
  if (view === 'statistics') return statisticsCells(player, statisticsUnavailable);
  if (view === 'physical') return physicalCells(player);
  if (view === 'ability') return abilityCells(player);
  return contractCells(player);
}

function sortValue(player, key) {
  const stats = statisticsCache.get(playerId(player));
  const record = abilityByPlayer[playerId(player)] || {};
  const change = record.latest_change || null;
  if (key === 'squad_number') return Number(player.squad_number);
  if (key === 'name') return playerName(player);
  if (key === 'position') return POSITION_ORDER.indexOf(canonicalPosition(player));
  if (key === 'age') return Number(player.age);
  if (key === 'tbg') return Number(playerRating(player));
  if (key === 'fitness') return Number(player.fitness ?? 100);
  if (key === 'morale') return String(player.morale || 'Good');
  if (key === 'availability') return availabilityLabel(player);
  if (key === 'contract' || key === 'published') {
    const value = key === 'contract' ? contractValue(player) : (change?.published_at || change?.slot);
    const time = value ? new Date(value).getTime() : NaN;
    return Number.isFinite(time) ? time : null;
  }
  if (key === 'status') return statusText(player);
  if (key === 'apps') return stats?.appearances ?? null;
  if (key === 'goals') return stats?.goals ?? null;
  if (key === 'assists') return stats?.assists ?? null;
  if (key === 'avp') return stats?.average_match_rating == null ? null : Number(stats.average_match_rating);
  if (key === 'last5') return recentAverage(stats);
  if (key === 'previous') return change?.before == null ? null : Number(change.before);
  if (key === 'change') return change?.delta == null ? null : Number(change.delta);
  if (key === 'latest_state') return change ? `${change.before ?? ''}-${change.after ?? ''}` : null;
  if (key === 'history') return Array.isArray(record.history) ? record.history.length : 0;
  if (key === 'transfer') return player.transfer_listed ? 1 : 0;
  if (key === 'loan') return isLoanedOutPlayer(player) ? 2 : player.loan_listed ? 1 : 0;
  return null;
}

function compareValues(a, b, direction) {
  const aMissing = a == null || (typeof a === 'number' && !Number.isFinite(a));
  const bMissing = b == null || (typeof b === 'number' && !Number.isFinite(b));
  if (aMissing !== bMissing) return aMissing ? 1 : -1;
  if (aMissing) return 0;
  const result = typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
  return direction === 'asc' ? result : -result;
}

function coverageCards(coverage = []) {
  return coverage.map((row) => {
    const state = row.gap ? 'critical' : row.temporary_gap ? 'warning' : 'good';
    return `<article class="depth-card ${state}"><span>${escapeHtml(row.group)}</span><strong>${row.registered}/${row.required}</strong><small>${row.available} available${row.gap ? ` · ${row.gap} short` : row.temporary_gap ? ` · ${row.temporary_gap} temporarily short` : ' · covered'}</small></article>`;
  }).join('');
}

function contractWatchRows(contracts = []) {
  return contracts.length ? contracts.slice(0, 8).map((row) => `<article class="contract-row"><div><strong>${escapeHtml(row.player_name)}</strong><small>${escapeHtml(row.position)}</small></div><div><strong>${row.days_remaining <= 0 ? 'Expired' : `${wholeNumber(row.days_remaining)} days`}</strong><small>${new Date(row.end_at).toLocaleDateString('en-GB')}</small></div></article>`).join('') : '<p class="portal-empty">No contracts expire in the next 12 months.</p>';
}

export function squadSummary(players = [], rules = {}) {
  return {
    firstTeam: players.filter((player) => !isYouthPlayer(player) && !isLoanedOutPlayer(player)).length,
    youth: players.filter((player) => isYouthPlayer(player) && !isLoanedOutPlayer(player)).length,
    loaned: players.filter(isLoanedOutPlayer).length,
    total: players.length,
    firstTeamCapacity: rules.first_team_capacity ?? 25,
    youthCapacity: rules.youth_team_capacity ?? 20
  };
}

export function mountReadOnlySquadView(root, club) {
  if (!root || !club) return;
  const players = Array.isArray(club.players) ? club.players : [];
  const summary = squadSummary(players, club.squad_rules || {});
  const positions = [...new Set(players.map(canonicalPosition))].sort((a, b) => (POSITION_ORDER.indexOf(a) === -1 ? 999 : POSITION_ORDER.indexOf(a)) - (POSITION_ORDER.indexOf(b) === -1 ? 999 : POSITION_ORDER.indexOf(b)) || a.localeCompare(b));
  let sort = { key: 'position', dir: 'asc' };
  let statisticsUnavailable = false;
  let dataTicket = 0;

  root.innerHTML = `<section class="competition-card history-club-panel read-only-squad" id="historyClubPanel">
    <div class="section-heading"><div><span class="status-label">READ-ONLY CLUB INSPECTION</span><h2>${escapeHtml(club.club_name)}</h2><p>${escapeHtml(club.division_name)}${club.country ? ` · ${escapeHtml(club.country)}` : ''}${club.stadium ? ` · ${escapeHtml(club.stadium)}` : ''}</p></div><button type="button" data-close-club>Close</button></div>
    <div class="squad-summary"><div><span>First Team</span><strong>${summary.firstTeam} / ${summary.firstTeamCapacity}</strong></div><div><span>Youth Team</span><strong>${summary.youth} / ${summary.youthCapacity}</strong></div><div><span>Loaned Out</span><strong>${summary.loaned}</strong></div><div><span>Total Owned</span><strong>${summary.total}</strong></div></div>
    ${club.coverage?.length ? `<div class="portal-section-heading"><div><h3>Squad intelligence</h3><p>Registered and currently available cover against the playable minimum.</p></div></div><section class="squad-depth-grid">${coverageCards(club.coverage)}</section>` : ''}
    ${club.contracts ? `<section class="portal-card"><h3>Contract watch · next 12 months</h3><div class="contract-watch">${contractWatchRows(club.contracts)}</div></section>` : ''}
    <div class="squad-filters"><label>Display<select data-squad-data-view>${Object.entries(DATA_VIEWS).map(([value, view]) => `<option value="${value}">${view.label}</option>`).join('')}</select></label><label>Squad view<select data-squad-view><option value="first_team">First Team</option><option value="full">Full Team</option><option value="youth">Youth Team</option><option value="loaned_out">Loaned Out</option></select></label><label>Search<input data-squad-search type="search" placeholder="Player or position"></label><label>Position<select data-position-filter><option value="all">All positions</option>${positions.map((position) => `<option>${escapeHtml(position)}</option>`).join('')}</select></label><label>Availability<select data-availability-filter><option value="all">All</option><option value="available">Available</option><option value="injured">Injured or suspended</option><option value="listed">Transfer listed</option><option value="loan">Loan listed</option></select></label></div>
    <p class="read-only-note">Registration, transfers and team-selection controls are available only to the appointed manager.</p>
    <p class="squad-data-view-status" data-squad-data-status hidden></p>
    <div class="section-heading compact"><h3>Players</h3><span data-squad-count></span></div>
    <div class="table-wrap"><table class="competition-table squad-table"><thead><tr data-squad-headers></tr></thead><tbody data-squad-rows></tbody></table></div>
  </section>`;

  const status = (message = '') => {
    const node = root.querySelector('[data-squad-data-status]');
    node.textContent = message;
    node.hidden = !message;
  };

  const updateHeaders = () => {
    const viewName = root.querySelector('[data-squad-data-view]').value;
    root.querySelector('[data-squad-headers]').innerHTML = DATA_VIEWS[viewName].headers.map(([label, key]) => `<th data-sort="${key}" class="${sort.key === key ? 'active-sort' : ''}" data-arrow="${sort.key === key ? (sort.dir === 'asc' ? '▲' : '▼') : ''}">${escapeHtml(label)}</th>`).join('');
  };

  const filtered = () => {
    const view = root.querySelector('[data-squad-view]').value;
    const query = root.querySelector('[data-squad-search]').value.trim().toLowerCase();
    const wantedPosition = root.querySelector('[data-position-filter]').value;
    const availability = root.querySelector('[data-availability-filter]').value;
    let rows = players.filter((player) => registrationView(player, view)).filter((player) => `${playerName(player)} ${canonicalPosition(player)}`.toLowerCase().includes(query));
    if (wantedPosition !== 'all') rows = rows.filter((player) => canonicalPosition(player) === wantedPosition);
    if (availability === 'available') rows = rows.filter(isAvailable);
    if (availability === 'injured') rows = rows.filter((player) => !isAvailable(player));
    if (availability === 'listed') rows = rows.filter((player) => player.transfer_listed);
    if (availability === 'loan') rows = rows.filter((player) => player.loan_listed);
    rows.sort((a, b) => compareValues(sortValue(a, sort.key), sortValue(b, sort.key), sort.dir) || playerName(a).localeCompare(playerName(b)));
    return rows;
  };

  const render = () => {
    const dataView = root.querySelector('[data-squad-data-view]').value;
    const rows = filtered();
    const grouped = sort.key === 'position';
    let previousPosition = '';
    const html = rows.map((player) => {
      const position = canonicalPosition(player);
      const separator = grouped && position !== previousPosition ? `<tr class="position-separator"><td colspan="10">${escapeHtml(position)}</td></tr>` : '';
      previousPosition = position;
      return `${separator}<tr>${rowCells(player, dataView, statisticsUnavailable)}</tr>`;
    }).join('');
    root.querySelector('[data-squad-count]').textContent = `${rows.length} players · ${DATA_VIEWS[dataView].label}`;
    root.querySelector('[data-squad-rows]').innerHTML = html || '<tr><td colspan="10" class="empty-state">No players match this squad view and filter.</td></tr>';
    updateHeaders();
    window.dispatchEvent(new CustomEvent('tbg:read-only-squad-rendered', { detail: { root, players: rows, squad: players, club } }));
  };

  const prepareDataView = async () => {
    const ticket = ++dataTicket;
    const dataView = root.querySelector('[data-squad-data-view]').value;
    statisticsUnavailable = false;
    status('');
    if (dataView === 'statistics') {
      status('Loading persisted season statistics…');
      render();
      try {
        await loadStatistics(players, club.world_id || club.worldId);
      } catch (error) {
        statisticsUnavailable = true;
        status(`Season statistics unavailable · ${error.message}`);
      }
    } else if (dataView === 'ability') {
      status('Loading governed Ability history…');
      try {
        await loadAbility();
      } catch (error) {
        status(`Ability history unavailable · ${error.message}`);
      }
    }
    if (ticket !== dataTicket) return;
    if (!statisticsUnavailable && dataView !== 'ability') status('');
    if (dataView === 'ability' && Object.keys(abilityByPlayer).length) status('');
    render();
  };

  root.querySelector('[data-squad-data-view]').addEventListener('change', () => {
    sort = { key: 'position', dir: 'asc' };
    prepareDataView();
  });
  root.querySelector('[data-squad-view]').addEventListener('change', render);
  root.querySelector('[data-squad-search]').addEventListener('input', render);
  root.querySelector('[data-position-filter]').addEventListener('change', render);
  root.querySelector('[data-availability-filter]').addEventListener('change', render);
  root.querySelector('.squad-table thead').addEventListener('click', (event) => {
    const header = event.target.closest('th[data-sort]');
    if (!header) return;
    const key = header.dataset.sort;
    sort = sort.key === key ? { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'name' || key === 'position' || key === 'availability' || key === 'status' ? 'asc' : 'desc' };
    render();
  });
  render();
}
