const originalFetch = window.fetch.bind(window);
let competitionState = null;

const escapeHtml = (value) => String(value ?? '').replace(/[&<>\"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;' }[character]));
const formatDate = (value) => value ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value)) : '—';
const resultClass = (fixture) => fixture.own_score > fixture.opponent_score ? 'win' : fixture.own_score < fixture.opponent_score ? 'loss' : 'draw';
const resultLetter = (fixture) => resultClass(fixture) === 'win' ? 'W' : resultClass(fixture) === 'loss' ? 'L' : 'D';

function showCompetitionView() {
  document.querySelectorAll('.view').forEach((view) => view.classList.toggle('active', view.id === 'competitionsView'));
  document.querySelectorAll('[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === 'competitions'));
}

function renderLastFixture(fixture) {
  const card = document.getElementById('lastFixtureCard');
  if (!card) return;
  if (!fixture) {
    card.innerHTML = '<div class="placeholder">No matches played yet</div>';
    return;
  }
  card.innerHTML = `
    <button type="button" class="match-centre-link last-result-button" data-match-centre="${escapeHtml(fixture.fixture_id || fixture.id)}" aria-label="Open match report">
      <div class="last-result-score">${escapeHtml(fixture.own_score)}–${escapeHtml(fixture.opponent_score)}</div>
      <strong>${escapeHtml(fixture.opponent_name)}</strong>
      <span class="result-pill ${resultClass(fixture)}">${resultLetter(fixture)}</span>
      <small>Matchday ${escapeHtml(fixture.matchday ?? '—')} · ${formatDate(fixture.played_at)}</small>
      <span class="view-report-label">View match report</span>
    </button>
  `;
}

function renderHistory(fixtures = []) {
  const body = document.getElementById('fixtureHistoryRows');
  if (!body) return;
  body.innerHTML = fixtures.length ? fixtures.map((fixture) => `
    <tr class="match-centre-row" data-match-centre="${escapeHtml(fixture.fixture_id || fixture.id)}" tabindex="0" role="button" aria-label="Open match report against ${escapeHtml(fixture.opponent_name)}">
      <td>${escapeHtml(fixture.matchday ?? '—')}</td>
      <td>${formatDate(fixture.played_at)}</td>
      <td>${escapeHtml(fixture.venue)}</td>
      <td>${escapeHtml(fixture.opponent_name)}</td>
      <td><strong>${escapeHtml(fixture.own_score)}–${escapeHtml(fixture.opponent_score)}</strong></td>
      <td><span class="result-pill ${resultClass(fixture)}">${resultLetter(fixture)}</span></td>
    </tr>
  `).join('') : '<tr><td colspan="6" class="empty-state">No completed fixtures yet.</td></tr>';
}

function renderStandings(rows = []) {
  const body = document.getElementById('standingsRows');
  if (!body) return;
  body.innerHTML = rows.length ? rows.map((row) => `
    <tr class="${row.is_managed_club ? 'managed-club-row' : ''}">
      <td>${escapeHtml(row.position)}</td><td>${escapeHtml(row.club_name)}</td><td>${escapeHtml(row.played)}</td><td>${escapeHtml(row.won)}</td><td>${escapeHtml(row.drawn)}</td><td>${escapeHtml(row.lost)}</td><td>${escapeHtml(row.goals_for)}</td><td>${escapeHtml(row.goals_against)}</td><td>${Number(row.goal_difference) > 0 ? '+' : ''}${escapeHtml(row.goal_difference)}</td><td><strong>${escapeHtml(row.points)}</strong></td>
      <td class="form-cell">${(row.form || []).map((result) => `<span class="form-dot ${result === 'W' ? 'win' : result === 'L' ? 'loss' : 'draw'}">${escapeHtml(result)}</span>`).join('')}</td>
    </tr>
  `).join('') : '<tr><td colspan="11" class="empty-state">The table will appear after the first completed league fixture.</td></tr>';
}

function renderCompetition(data) {
  competitionState = data;
  renderLastFixture(data.last_fixture);
  renderHistory(data.fixture_history || []);
  renderStandings(data.competition?.standings || []);
  const title = document.getElementById('competitionTitle');
  if (title) title.textContent = String(data.competition?.competition_id || 'Competition').replace('division-', 'Division ');
}

window.fetch = async (...args) => {
  const response = await originalFetch(...args);
  const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
  if (url.includes('/api/bootstrap') && response.ok) response.clone().json().then((data) => setTimeout(() => renderCompetition(data), 0)).catch(() => null);
  return response;
};

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('clubNav')?.addEventListener('click', (event) => {
    const link = event.target.closest('a');
    if (!link || link.textContent.trim() !== 'Competitions') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    showCompetitionView();
    if (competitionState) renderCompetition(competitionState);
  }, true);
});
