import { mountReadOnlySquadView } from './squad-view.js';

const escapeHtml = (value) => String(value ?? '').replace(/[&<>\"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;' }[character]));
let loaded = false;
let state = null;
let accessToken = '';
let renderedResults = [];
const originalFetch = window.fetch.bind(window);
window.fetch = async (...args) => {
  const headers = args[1]?.headers || {};
  const authorization = headers.authorization || headers.Authorization || '';
  if (String(authorization).toLowerCase().startsWith('bearer ')) accessToken = String(authorization).slice(7).trim();
  return originalFetch(...args);
};

function storedAccessToken() {
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

function clubButton(row) {
  if (!row.club_id || !state?.clubs?.[row.club_id]) return escapeHtml(row.club_name);
  return `<button class="history-club-link" type="button" data-club-id="${escapeHtml(row.club_id)}">${escapeHtml(row.club_name)}</button>`;
}

function table(rows = []) {
  return `<div class="table-wrap"><table class="competition-table"><thead><tr><th>Pos</th><th>Club</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GF</th><th>GA</th><th>GD</th><th>Pts</th></tr></thead><tbody>${rows.map((row) => `<tr class="${row.is_managed_club ? 'managed-club-row' : ''}"><td>${row.position}</td><td>${clubButton(row)}</td><td>${row.played}</td><td>${row.won}</td><td>${row.drawn}</td><td>${row.lost}</td><td>${row.goals_for}</td><td>${row.goals_against}</td><td>${row.goal_difference > 0 ? '+' : ''}${row.goal_difference}</td><td><strong>${row.points}</strong></td></tr>`).join('')}</tbody></table></div>`;
}

function openClubPanel(content, clubId) {
  const club = state?.clubs?.[clubId];
  if (!club) return;
  content.querySelector('.history-club-host')?.remove();
  const host = document.createElement('div');
  host.className = 'history-club-host';
  content.prepend(host);
  mountReadOnlySquadView(host, club);
  const panel = host.querySelector('#historyClubPanel');
  panel?.querySelector('[data-close-club]')?.addEventListener('click', () => host.remove());
  panel?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function bindClubLinks(content) {
  content.querySelectorAll('[data-club-id]').forEach((button) => button.addEventListener('click', () => openClubPanel(content, button.dataset.clubId)));
}

function render(data) {
  state = data;
  const root = document.getElementById('historyView');
  if (!root) return;
  root.innerHTML = `<div class="section-heading"><div><h2>World History</h2><p>Live tables for every published division, full club squads and persisted season records.</p></div><span>${data.completed_season_count} completed seasons</span></div><div class="history-tabs"><button data-history-tab="live">Live tables</button><button data-history-tab="archive">Season archive</button><button data-history-tab="club">My club history</button></div><div id="historyContent"></div>`;
  root.querySelector('.history-tabs').addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (button) show(button.dataset.historyTab);
  });
  show('live');
}

function show(tab) {
  const content = document.getElementById('historyContent');
  if (!content || !state) return;
  if (tab === 'live') {
    content.innerHTML = state.live_divisions.map((division) => `<section class="competition-card"><h3>${escapeHtml(division.name)}</h3><p>${division.played_fixture_count} results · ${division.scheduled_fixture_count} fixtures · Click any club to view its squad — now as the full read-only squad screen</p>${table(division.standings)}</section>`).join('');
    bindClubLinks(content);
  }
  if (tab === 'club') {
    const history = state.managed_club_history;
    content.innerHTML = `<section class="competition-card"><h3>${escapeHtml(history.club_name)}</h3><p>${history.seasons.length} archived campaigns · ${history.honours.length} honours</p>${table(history.seasons)}</section><section class="competition-card"><h3>Promotion and relegation</h3>${history.movements.length ? history.movements.map((movement) => `<p>${escapeHtml(movement.season_id)}: ${escapeHtml(movement.from_division_name)} → ${escapeHtml(movement.to_division_name)}</p>`).join('') : '<p>No recorded movement yet.</p>'}</section>`;
    bindClubLinks(content);
  }
  if (tab === 'archive') {
    renderedResults = [];
    content.innerHTML = state.seasons.length ? state.seasons.map((season) => `<details class="season-archive"><summary>Season ${season.season_number || escapeHtml(season.season_id)}</summary>${season.divisions.map((division) => `<section class="competition-card"><h3>${escapeHtml(division.name)} — ${escapeHtml(division.summary.champion_club_name)} champions</h3>${table(division.standings)}<div class="honours-grid">${Object.entries(division.awards).filter(([, award]) => award).map(([key, award]) => `<div><span>${escapeHtml(key.replaceAll('_', ' '))}</span><strong>${escapeHtml(award.player_name || award.club_name)}</strong></div>`).join('')}</div><h4>Results</h4>${division.results.length ? division.results.map((result) => { const index = renderedResults.push(result) - 1; return `<button class="archive-result" data-result-index="${index}">MD ${result.matchday}: ${escapeHtml(result.home_club_name)} ${result.home_score}–${result.away_score} ${escapeHtml(result.away_club_name)}</button>`; }).join('') : `<p>${division.legacy_result_count} results are indexed, but detailed reports are not yet present in the external report store.</p>`}</section>`).join('')}</details>`).join('') : '<p>No completed seasons yet.</p>';
    bindClubLinks(content);
    content.querySelectorAll('[data-result-index]').forEach((button) => button.addEventListener('click', () => {
      const result = renderedResults[Number(button.dataset.resultIndex)];
      if (!result) return;
      const commentary = (result.events || []).map((event) => event.commentary || event.description || event.type).filter(Boolean).join('\n') || 'No event commentary stored.';
      window.alert(`${result.home_club_name} ${result.home_score}–${result.away_score} ${result.away_club_name}\n\n${commentary}`);
    }));
  }
}

async function load() {
  if (loaded) return;
  accessToken ||= storedAccessToken();
  if (!accessToken) return;
  const response = await fetch('/api/history', { headers: { authorization: `Bearer ${accessToken}` } });
  if (!response.ok) return;
  loaded = true;
  render(await response.json());
}

document.addEventListener('tbg:view-changed', (event) => {
  if (event.detail?.view === 'history') load();
});
