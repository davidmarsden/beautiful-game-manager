import './club-inspection.js';

const originalFetch = window.fetch.bind(window);
let competitionState = null;
let competitionAuth = '';
let divisionRounds = null;
let roundMode = 'results';
let selectedMatchday = null;

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[character]));
const formatDate = (value) => value ? new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value)) : '—';
const formatTime = (value) => value ? new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : 'TBC';
const hasScore = (fixture) => fixture?.own_score != null && fixture?.opponent_score != null;
const resultClass = (fixture) => fixture.own_score > fixture.opponent_score ? 'win' : fixture.own_score < fixture.opponent_score ? 'loss' : 'draw';
const resultLetter = (fixture) => resultClass(fixture) === 'win' ? 'W' : resultClass(fixture) === 'loss' ? 'L' : 'D';
const clubLink = (clubId, clubName, className = 'portal-club-link') => clubId
  ? `<span role="link" tabindex="0" class="${className}" data-club-id="${escapeHtml(clubId)}">${escapeHtml(clubName)}</span>`
  : escapeHtml(clubName);

function showCompetitionView() {
  document.querySelectorAll('.view').forEach((view) => view.classList.toggle('active', view.id === 'competitionsView'));
  document.querySelectorAll('[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === 'competitions'));
}

function renderLastFixture(fixture) {
  const card = document.getElementById('lastFixtureCard');
  if (!card) return;
  if (!fixture) { card.innerHTML = '<div class="placeholder">No matches played yet</div>'; return; }
  const hidden = !fixture.result_revealed;
  card.innerHTML = `<button type="button" class="match-centre-link last-result-button ${hidden ? 'result-hidden' : ''}" data-match-centre="${escapeHtml(fixture.fixture_id || fixture.id)}" aria-label="${hidden ? 'Watch match replay' : 'Open match report'}"><div class="last-result-score">${hidden ? 'MATCH READY' : `${escapeHtml(fixture.own_score)}–${escapeHtml(fixture.opponent_score)}`}</div><strong>${clubLink(fixture.opponent_id, fixture.opponent_name, 'portal-club-link inline')}</strong>${hidden ? '<span class="result-pill draw">?</span>' : `<span class="result-pill ${resultClass(fixture)}">${resultLetter(fixture)}</span>`}<small>Matchday ${escapeHtml(fixture.matchday ?? '—')} · ${formatDate(fixture.played_at)}</small><span class="view-report-label">${hidden ? 'Watch replay' : 'View match report'}</span></button>`;
}

function renderHistory(fixtures = []) {
  const body = document.getElementById('fixtureHistoryRows');
  if (!body) return;
  body.innerHTML = fixtures.length ? fixtures.map((fixture) => {
    const hidden = !fixture.result_revealed;
    return `<tr class="match-centre-row ${hidden ? 'result-hidden' : ''}" data-match-centre="${escapeHtml(fixture.fixture_id || fixture.id)}" tabindex="0" role="button"><td>${escapeHtml(fixture.matchday ?? '—')}</td><td>${formatDate(fixture.played_at)}</td><td>${escapeHtml(fixture.venue)}</td><td>${clubLink(fixture.opponent_id, fixture.opponent_name)}</td><td><strong>${hidden ? 'MATCH READY' : `${escapeHtml(fixture.own_score)}–${escapeHtml(fixture.opponent_score)}`}</strong></td><td>${hidden ? '<span class="result-pill draw">?</span>' : `<span class="result-pill ${resultClass(fixture)}">${resultLetter(fixture)}</span>`}</td></tr>`;
  }).join('') : '<tr><td colspan="6" class="empty-state">No completed fixtures yet.</td></tr>';
}

function renderStandings(rows = []) {
  const body = document.getElementById('standingsRows');
  if (!body) return;
  body.innerHTML = rows.length ? rows.map((row) => `<tr class="${row.is_managed_club ? 'managed-club-row' : ''}"><td>${escapeHtml(row.position)}</td><td>${clubLink(row.club_id, row.club_name)}</td><td>${escapeHtml(row.played)}</td><td>${escapeHtml(row.won)}</td><td>${escapeHtml(row.drawn)}</td><td>${escapeHtml(row.lost)}</td><td>${escapeHtml(row.goals_for ?? row.gf ?? 0)}</td><td>${escapeHtml(row.goals_against ?? row.ga ?? 0)}</td><td>${Number(row.goal_difference ?? row.gd ?? 0) > 0 ? '+' : ''}${escapeHtml(row.goal_difference ?? row.gd ?? 0)}</td><td><strong>${escapeHtml(row.points)}</strong></td><td class="form-cell">${(row.form || []).map((result) => `<span class="form-dot ${result === 'W' ? 'win' : result === 'L' ? 'loss' : 'draw'}">${escapeHtml(result)}</span>`).join('')}</td></tr>`).join('') : '<tr><td colspan="11" class="empty-state">The table will appear after the first completed league fixture.</td></tr>';
}

function renderSchedule(fixtures = []) {
  const view = document.getElementById('scheduleView');
  if (!view) return;
  const rows = fixtures.map((fixture) => {
    const played = fixture.status === 'played';
    const scoreKnown = played && hasScore(fixture);
    const score = scoreKnown ? `${escapeHtml(fixture.own_score)}–${escapeHtml(fixture.opponent_score)}` : '—';
    const outcome = scoreKnown ? `<span class="result-pill ${resultClass(fixture)}">${resultLetter(fixture)}</span>` : played ? '<span class="badge neutral">Played</span>' : '<span class="badge neutral">Scheduled</span>';
    const report = played ? `<button type="button" class="match-centre-link" data-match-centre="${escapeHtml(fixture.fixture_id || fixture.id)}">Match report</button>` : '';
    return `<tr><td>${escapeHtml(fixture.matchday ?? '—')}</td><td>${formatDate(fixture.kickoff_at)}</td><td>${escapeHtml(fixture.venue)}</td><td>${clubLink(fixture.opponent_id, fixture.opponent_name)}</td><td><strong>${score}</strong></td><td>${outcome}</td><td>${report}</td></tr>`;
  }).join('');
  view.innerHTML = `<div class="section-heading"><div><h2>Schedule</h2><p>The full canonical league schedule for the appointed club.</p></div><span>${fixtures.length} fixtures</span></div><div class="table-wrap"><table class="competition-table fixture-schedule-table"><thead><tr><th>MD</th><th>Date</th><th>Venue</th><th>Opponent</th><th>Score</th><th>Status</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="7" class="empty-state">Fixtures have not been generated yet.</td></tr>'}</tbody></table></div>`;
}

function roundFor(matchday) {
  return divisionRounds?.rounds?.find((round) => Number(round.matchday) === Number(matchday)) || null;
}

function availableMatchdays(mode) {
  return (divisionRounds?.rounds || []).filter((round) => mode === 'results'
    ? round.fixtures.some((fixture) => fixture.status === 'played')
    : round.fixtures.some((fixture) => fixture.status !== 'played')).map((round) => Number(round.matchday));
}

function scoreMarkup(fixture) {
  if (fixture.status !== 'played') return `<span class="round-kickoff">${formatTime(fixture.kickoff_at)}</span>`;
  if (!fixture.result_revealed) return fixture.managed_fixture
    ? `<button type="button" class="round-score match-centre-link result-hidden" data-match-centre="${escapeHtml(fixture.fixture_id)}">MATCH READY</button>`
    : '<span class="round-score result-hidden">RESULT HIDDEN</span>';
  return `<span class="round-score">${escapeHtml(fixture.home_score)}–${escapeHtml(fixture.away_score)}</span>`;
}

function renderDivisionRound() {
  const card = document.getElementById('divisionRoundCard');
  if (!card) return;
  if (!divisionRounds) { card.innerHTML = '<div class="competition-round-loading">Loading division fixtures…</div>'; return; }
  const matchdays = availableMatchdays(roundMode);
  if (!matchdays.length) {
    card.innerHTML = `<div class="competition-round-tabs"><button class="${roundMode === 'results' ? 'active' : ''}" data-round-mode="results">Results</button><button class="${roundMode === 'fixtures' ? 'active' : ''}" data-round-mode="fixtures">Fixtures</button></div><p class="empty-state">No ${roundMode} are available yet.</p>`;
    return;
  }
  if (!matchdays.includes(Number(selectedMatchday))) selectedMatchday = roundMode === 'results' ? Math.max(...matchdays) : Math.min(...matchdays);
  const round = roundFor(selectedMatchday);
  const visibleFixtures = (round?.fixtures || []).filter((fixture) => roundMode === 'results' ? fixture.status === 'played' : fixture.status !== 'played');
  const currentIndex = matchdays.indexOf(Number(selectedMatchday));
  const date = visibleFixtures[0]?.played_at || visibleFixtures[0]?.kickoff_at;
  card.innerHTML = `<div class="competition-round-header"><div><h2>Division Matchdays</h2><p>Complete ${roundMode} for every club in ${escapeHtml(divisionRounds.division?.name || 'the division')}.</p></div><div class="competition-round-tabs"><button class="${roundMode === 'results' ? 'active' : ''}" data-round-mode="results">Results</button><button class="${roundMode === 'fixtures' ? 'active' : ''}" data-round-mode="fixtures">Fixtures</button></div></div><div class="round-navigation"><button type="button" data-round-step="-1" ${currentIndex <= 0 ? 'disabled' : ''}>‹ Previous</button><div><strong>Matchday ${escapeHtml(selectedMatchday)}</strong><span>${formatDate(date)}</span></div><button type="button" data-round-step="1" ${currentIndex >= matchdays.length - 1 ? 'disabled' : ''}>Next ›</button></div><div class="division-round-list">${visibleFixtures.map((fixture) => `<article class="division-round-fixture ${fixture.managed_fixture ? 'managed-fixture' : ''}"><div class="round-club home">${clubLink(fixture.home_club_id, fixture.home_club_name)}</div>${scoreMarkup(fixture)}<div class="round-club away">${clubLink(fixture.away_club_id, fixture.away_club_name)}</div></article>`).join('')}</div><div class="round-count">Matchday ${escapeHtml(selectedMatchday)} of ${escapeHtml(divisionRounds.maximum_matchday || Math.max(...matchdays))}</div>`;
}

async function loadDivisionRounds() {
  if (divisionRounds) { renderDivisionRound(); return; }
  renderDivisionRound();
  try {
    const response = await originalFetch('/api/competition-rounds', { headers: competitionAuth ? { authorization: competitionAuth } : {} });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not load division fixtures');
    divisionRounds = data;
    const completed = availableMatchdays('results');
    selectedMatchday = completed.length ? Math.max(...completed) : Number(data.current_matchday || 1);
    renderDivisionRound();
  } catch (error) {
    const card = document.getElementById('divisionRoundCard');
    if (card) card.innerHTML = `<p class="empty-state">${escapeHtml(error.message)}</p>`;
  }
}

function ensureRoundCard() {
  const layout = document.querySelector('#competitionsView .competition-layout');
  if (!layout) return;
  let card = document.getElementById('divisionRoundCard');
  if (!card) {
    card = document.createElement('section');
    card.id = 'divisionRoundCard';
    card.className = 'competition-card division-round-card';
    const oldRecent = layout.querySelector('.competition-card:nth-child(2)');
    if (oldRecent) oldRecent.replaceWith(card); else layout.appendChild(card);
  }
}

function renderCompetition(data) {
  competitionState = data;
  renderLastFixture(data.last_fixture);
  renderHistory(data.fixture_history || []);
  renderStandings(data.competition?.standings || []);
  renderSchedule(data.schedule || data.fixtures || data.competition?.fixtures || []);
  const title = document.getElementById('competitionTitle');
  if (title) title.textContent = data.club?.division_name || String(data.competition?.competition_id || 'Competition').replace(/^d(\d+)$/, 'Division $1').replace('division-', 'Division ');
  ensureRoundCard();
  loadDivisionRounds();
}

window.fetch = async (...args) => {
  const headers = args[1]?.headers || (args[0] instanceof Request ? args[0].headers : null);
  const auth = headers instanceof Headers ? headers.get('authorization') : headers?.authorization;
  if (auth) competitionAuth = auth;
  const response = await originalFetch(...args);
  const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
  if (url.includes('/api/bootstrap') && response.ok) response.clone().json().then((data) => setTimeout(() => renderCompetition(data), 0)).catch(() => null);
  return response;
};

document.addEventListener('click', (event) => {
  const modeButton = event.target.closest('[data-round-mode]');
  if (modeButton) {
    roundMode = modeButton.dataset.roundMode;
    const matchdays = availableMatchdays(roundMode);
    selectedMatchday = roundMode === 'results' ? Math.max(...matchdays) : Math.min(...matchdays);
    renderDivisionRound();
    return;
  }
  const stepButton = event.target.closest('[data-round-step]');
  if (stepButton) {
    const matchdays = availableMatchdays(roundMode);
    const index = matchdays.indexOf(Number(selectedMatchday));
    selectedMatchday = matchdays[index + Number(stepButton.dataset.roundStep)] ?? selectedMatchday;
    renderDivisionRound();
  }
});
document.addEventListener('tbg:match-revealed', () => { divisionRounds = null; loadDivisionRounds(); });
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('clubNav')?.addEventListener('click', (event) => {
    const link = event.target.closest('a');
    if (!link || link.textContent.trim() !== 'Competitions') return;
    event.preventDefault(); event.stopImmediatePropagation(); showCompetitionView(); if (competitionState) renderCompetition(competitionState);
  }, true);
});
