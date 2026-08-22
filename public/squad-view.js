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

export const playerName = (player) => player.display_name || player.player_name || player.canonical_name || player.tbg_player_id || player.player_id || 'Unknown player';
export const playerRating = (player) => player.underlying_ability_rating ?? player.tbg_rating ?? player.rating ?? null;
export const canonicalPosition = (player) => {
  const raw = player.specific_position || player.position || player.primary_position || player.position_group || 'Unknown';
  return POSITION_ALIASES.get(String(raw).trim().toLowerCase()) || raw || 'Unknown';
};
export const isYouthPlayer = (player) => Boolean(player.youth_eligible_at_season_start ?? ((Number(player.season_start_age ?? player.age) || 99) <= 21));
export const isLoanedOutPlayer = (player) => Boolean(player.loaned_out || String(player.loan_status || '').toLowerCase() === 'loaned_out');

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

function statusBadges(player) {
  const badges = [];
  if (player.transfer_listed) badges.push('<span class="badge transfer">Listed</span>');
  if (player.loan_listed) badges.push('<span class="badge loan">Loan list</span>');
  if (isLoanedOutPlayer(player)) badges.push(`<span class="badge loaned">Loaned${player.loan_club_name ? ` · ${escapeHtml(player.loan_club_name)}` : ''}</span>`);
  if (!player.registered && !isYouthPlayer(player) && !isLoanedOutPlayer(player)) badges.push('<span class="badge neutral">Unregistered</span>');
  return badges.join(' ') || '<span class="badge neutral">Squad player</span>';
}

function availabilityBadge(player) {
  const label = player.injury_status || player.availability || 'Available';
  return `<span class="badge ${isAvailable(player) ? 'fit' : 'injured'}">${escapeHtml(label)}</span>`;
}

function contractLabel(player) {
  return escapeHtml(player.contract_expiry || player.contract_end_at || player.contract?.end_at || 'Open-ended');
}

function playerNameMarkup(player) {
  const name = escapeHtml(playerName(player));
  const id = escapeHtml(player.tbg_player_id || player.player_id || '');
  if (!player.profile_url) return `<span class="player-link player-link-unavailable" data-tbg-player-id="${id}" title="Pink Final profile not published yet">${name}</span>`;
  return `<a class="player-link" data-tbg-player-id="${id}" href="${escapeHtml(player.profile_url)}" target="_blank" rel="noopener">${name}</a>`;
}

function playerRow(player) {
  return `<tr><td>${player.squad_number ?? '—'}</td><td>${playerNameMarkup(player)}</td><td>${escapeHtml(canonicalPosition(player))}</td><td>${player.age ?? '—'}</td><td><strong>${playerRating(player) ?? '—'}</strong></td><td>${player.fitness ?? 100}%</td><td>${escapeHtml(player.morale || 'Good')}</td><td>${availabilityBadge(player)}</td><td>${contractLabel(player)}</td><td>${statusBadges(player)}</td></tr>`;
}

function renderRows(players) {
  let previousPosition = '';
  return players.map((player) => {
    const position = canonicalPosition(player);
    const separator = position !== previousPosition ? `<tr class="position-separator"><td colspan="10">${escapeHtml(position)}</td></tr>` : '';
    previousPosition = position;
    return separator + playerRow(player);
  }).join('');
}

function coverageCards(coverage = []) {
  return coverage.map((row) => {
    const state = row.gap ? 'critical' : row.temporary_gap ? 'warning' : 'good';
    return `<article class="depth-card ${state}"><span>${escapeHtml(row.group)}</span><strong>${row.registered}/${row.required}</strong><small>${row.available} available${row.gap ? ` · ${row.gap} short` : row.temporary_gap ? ` · ${row.temporary_gap} temporarily short` : ' · covered'}</small></article>`;
  }).join('');
}

function contractWatchRows(contracts = []) {
  return contracts.length ? contracts.slice(0, 8).map((row) => `<article class="contract-row"><div><strong>${escapeHtml(row.player_name)}</strong><small>${escapeHtml(row.position)}</small></div><div><strong>${row.days_remaining <= 0 ? 'Expired' : `${row.days_remaining} days`}</strong><small>${new Date(row.end_at).toLocaleDateString('en-GB')}</small></div></article>`).join('') : '<p class="portal-empty">No contracts expire in the next 12 months.</p>';
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

  root.innerHTML = `<section class="competition-card history-club-panel read-only-squad" id="historyClubPanel">
    <div class="section-heading"><div><span class="status-label">READ-ONLY CLUB INSPECTION</span><h2>${escapeHtml(club.club_name)}</h2><p>${escapeHtml(club.division_name)}${club.country ? ` · ${escapeHtml(club.country)}` : ''}${club.stadium ? ` · ${escapeHtml(club.stadium)}` : ''}</p></div><button type="button" data-close-club>Close</button></div>
    <div class="squad-summary"><div><span>First Team</span><strong>${summary.firstTeam} / ${summary.firstTeamCapacity}</strong></div><div><span>Youth Team</span><strong>${summary.youth} / ${summary.youthCapacity}</strong></div><div><span>Loaned Out</span><strong>${summary.loaned}</strong></div><div><span>Total Owned</span><strong>${summary.total}</strong></div></div>
    ${club.coverage?.length ? `<div class="portal-section-heading"><div><h3>Squad intelligence</h3><p>Registered and currently available cover against the playable minimum.</p></div></div><section class="squad-depth-grid">${coverageCards(club.coverage)}</section>` : ''}
    ${club.contracts ? `<section class="portal-card"><h3>Contract watch · next 12 months</h3><div class="contract-watch">${contractWatchRows(club.contracts)}</div></section>` : ''}
    <div class="squad-filters"><label>Squad view<select data-squad-view><option value="first_team">First Team</option><option value="full">Full Team</option><option value="youth">Youth Team</option><option value="loaned_out">Loaned Out</option></select></label><label>Search<input data-squad-search type="search" placeholder="Player or position"></label><label>Position<select data-position-filter><option value="all">All positions</option>${positions.map((position) => `<option>${escapeHtml(position)}</option>`).join('')}</select></label><label>Availability<select data-availability-filter><option value="all">All</option><option value="available">Available</option><option value="injured">Injured or suspended</option><option value="listed">Transfer listed</option><option value="loan">Loan listed</option></select></label></div>
    <p class="read-only-note">Registration, transfers and team-selection controls are available only to the appointed manager.</p>
    <div class="section-heading compact"><h3>Players</h3><span data-squad-count></span></div>
    <div class="table-wrap"><table class="competition-table squad-table"><thead><tr><th>#</th><th>Player</th><th>Position</th><th>Age</th><th>TBG</th><th>Fitness</th><th>Morale</th><th>Availability</th><th>Contract</th><th>Status</th></tr></thead><tbody data-squad-rows></tbody></table></div>
  </section>`;

  const render = () => {
    const view = root.querySelector('[data-squad-view]').value;
    const query = root.querySelector('[data-squad-search]').value.trim().toLowerCase();
    const position = root.querySelector('[data-position-filter]').value;
    const availability = root.querySelector('[data-availability-filter]').value;
    let rows = players.filter((player) => registrationView(player, view)).filter((player) => `${playerName(player)} ${canonicalPosition(player)}`.toLowerCase().includes(query));
    if (position !== 'all') rows = rows.filter((player) => canonicalPosition(player) === position);
    if (availability === 'available') rows = rows.filter(isAvailable);
    if (availability === 'injured') rows = rows.filter((player) => !isAvailable(player));
    if (availability === 'listed') rows = rows.filter((player) => player.transfer_listed);
    if (availability === 'loan') rows = rows.filter((player) => player.loan_listed);
    rows.sort((a, b) => POSITION_ORDER.indexOf(canonicalPosition(a)) - POSITION_ORDER.indexOf(canonicalPosition(b)) || (playerRating(b) ?? -1) - (playerRating(a) ?? -1) || playerName(a).localeCompare(playerName(b)));
    root.querySelector('[data-squad-count]').textContent = `${rows.length} players`;
    root.querySelector('[data-squad-rows]').innerHTML = rows.length ? renderRows(rows) : '<tr><td colspan="10" class="empty-state">No players match this squad view and filter.</td></tr>';
    window.dispatchEvent(new CustomEvent('tbg:read-only-squad-rendered', { detail: { root, players: rows } }));
  };

  root.querySelector('[data-squad-view]').addEventListener('change', render);
  root.querySelector('[data-squad-search]').addEventListener('input', render);
  root.querySelector('[data-position-filter]').addEventListener('change', render);
  root.querySelector('[data-availability-filter]').addEventListener('change', render);
  render();
}