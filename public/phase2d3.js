import './club-inspection.js';

const originalFetch = window.fetch.bind(window);
let competitionState = null;

const escapeHtml = (value) => String(value ?? '').replace(/[&<>\"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;' }[character]));
const formatDate = (value) => value ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value)) : '—';
const hasScore = (fixture) => fixture?.own_score != null && fixture?.opponent_score != null;
const resultClass = (fixture) => fixture.own_score > fixture.opponent_score ? 'win' : fixture.own_score < fixture.opponent_score ? 'loss' : 'draw';
const resultLetter = (fixture) => resultClass(fixture) === 'win' ? 'W' : resultClass(fixture) === 'loss' ? 'L' : 'D';
const clubLink = (clubId, clubName, className = 'portal-club-link') => clubId
  ? `<button type="button" class="${className}" data-club-id="${escapeHtml(clubId)}">${escapeHtml(clubName)}</button>`
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
  card.innerHTML = `
    <button type="button" class="match-centre-link last-result-button ${hidden ? 'result-hidden' : ''}" data-match-centre="${escapeHtml(fixture.fixture_id || fixture.id)}" aria-label="${hidden ? 'Watch match replay' : 'Open match report'}">
      <div class="last-result-score">${hidden ? 'MATCH READY' : `${escapeHtml(fixture.own_score)}–${escapeHtml(fixture.opponent_score)}`}</div>
      <strong>${clubLink(fixture.opponent_id, fixture.opponent_name, 'portal-club-link inline')}</strong>
      ${hidden ? '<span class="result-pill draw">?</span>' : `<span class="result-pill ${resultClass(fixture)}">${resultLetter(fixture)}</span>`}
      <small>Matchday ${escapeHtml(fixture.matchday ?? '—')} · ${formatDate(fixture.played_at)}</small>
      <span class="view-report-label">${hidden ? 'Watch replay' : 'View match report'}</span>
    </button>`;
}

function renderHistory(fixtures = []) {
  const body = document.getElementById('fixtureHistoryRows');
  if (!body) return;
  body.innerHTML = fixtures.length ? fixtures.map((fixture) => {
    const hidden = !fixture.result_revealed;
    return `<tr class="match-centre-row ${hidden ? 'result-hidden' : ''}" data-match-centre="${escapeHtml(fixture.fixture_id || fixture.id)}" tabindex="0" role="button" aria-label="${hidden ? 'Watch match replay' : `Open match report against ${escapeHtml(fixture.opponent_name)}`}">
      <td>${escapeHtml(fixture.matchday ?? '—')}</td><td>${formatDate(fixture.played_at)}</td><td>${escapeHtml(fixture.venue)}</td><td>${clubLink(fixture.opponent_id, fixture.opponent_name)}</td>
      <td><strong>${hidden ? 'MATCH READY' : `${escapeHtml(fixture.own_score)}–${escapeHtml(fixture.opponent_score)}`}</strong></td>
      <td>${hidden ? '<span class="result-pill draw">?</span>' : `<span class="result-pill ${resultClass(fixture)}">${resultLetter(fixture)}</span>`}</td></tr>`;
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

function renderCompetition(data) {
  competitionState = data;
  renderLastFixture(data.last_fixture);
  renderHistory(data.fixture_history || []);
  renderStandings(data.competition?.standings || []);
  renderSchedule(data.schedule || data.fixtures || data.competition?.fixtures || []);
  const title = document.getElementById('competitionTitle');
  if (title) title.textContent = data.club?.division_name || String(data.competition?.competition_id || 'Competition').replace(/^d(\d+)$/, 'Division $1').replace('division-', 'Division ');
}
window.fetch = async (...args) => {
  const response = await originalFetch(...args);
  const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
  if (url.includes('/api/bootstrap') && response.ok) response.clone().json().then((data) => setTimeout(() => renderCompetition(data), 0)).catch(() => null);
  return response;
};
document.addEventListener('tbg:match-revealed', () => { window.location.reload(); });
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('clubNav')?.addEventListener('click', (event) => {
    const link = event.target.closest('a');
    if (!link || link.textContent.trim() !== 'Competitions') return;
    event.preventDefault(); event.stopImmediatePropagation(); showCompetitionView(); if (competitionState) renderCompetition(competitionState);
  }, true);
});
