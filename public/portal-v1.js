import { buildPortalViewModel } from './portal-v1-model.js';

const $ = (id) => document.getElementById(id);
const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));

function mountPortalWorkspace() {
  if (!document.querySelector('link[href="./portal-v1.css"]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = './portal-v1.css';
    document.head.append(link);
  }

  const dashboard = $('dashboardView');
  if (dashboard && !$('portalOverview')) {
    dashboard.insertAdjacentHTML('afterbegin', `
      <section id="portalOverview" class="portal-overview" aria-label="Club overview"></section>
      <section class="portal-layout">
        <article class="portal-card"><h3>Club actions</h3><div id="clubAlerts" class="portal-alerts"><p class="portal-empty">Loading club priorities…</p></div></article>
        <article class="portal-card"><h3>Season status</h3><div class="season-progress-shell"><div id="seasonProgressBar" class="season-progress-bar"></div></div><p id="seasonProgressText" class="portal-empty">Loading season progress…</p></article>
      </section>`);
  }

  const squad = $('squadView');
  if (squad && !$('squadDepthCards')) {
    const heading = squad.querySelector('.section-heading');
    heading?.insertAdjacentHTML('afterend', `
      <div class="portal-section-heading"><div><h3>Squad intelligence</h3><p>Registered and currently available cover against the playable minimum.</p></div></div>
      <section id="squadDepthCards" class="squad-depth-grid"></section>
      <section class="portal-card"><h3>Contract watch · next 12 months</h3><div id="contractWatchList" class="contract-watch"><p class="portal-empty">Loading contracts…</p></div></section>`);
  }

  const schedule = $('scheduleView');
  if (schedule && !schedule.querySelector('.portal-schedule-progress')) {
    schedule.insertAdjacentHTML('beforeend', `<section class="portal-card portal-schedule-progress"><h3>Season progress</h3><div class="season-progress-shell"><div class="season-progress-bar" data-progress-copy></div></div><p class="portal-empty" data-progress-text>Fixtures will populate as the world advances.</p></section>`);
  }

  const competitions = $('competitionsView');
  if (competitions && !$('seasonArchiveSummary')) {
    competitions.insertAdjacentHTML('beforeend', `<section class="portal-card"><h3>Season honours and records</h3><div id="seasonArchiveSummary" class="season-archive-summary"><p class="portal-empty">End-of-season awards will appear here when the season archive is created.</p></div></section>`);
  }
}

mountPortalWorkspace();

const nativeFetch = window.fetch.bind(window);
window.fetch = async (...args) => {
  const response = await nativeFetch(...args);
  const requestUrl = typeof args[0] === 'string' ? args[0] : args[0]?.url;
  if (requestUrl && new URL(requestUrl, window.location.href).pathname === '/api/bootstrap' && response.ok) {
    response.clone().json().then((data) => {
      if (!data?.no_assignment) window.dispatchEvent(new CustomEvent('tbg:portal-rendered', { detail: data }));
    }).catch((error) => console.warn('Could not read portal bootstrap response', error));
  }
  return response;
};

function showView(name) {
  document.querySelectorAll('.view').forEach((view) => view.classList.toggle('active', view.id === `${name}View`));
  document.querySelectorAll('[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === name));
  document.querySelector(`#${name}View`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderSummary(model) {
  if (!$('portalOverview')) return;
  const position = model.summary.table_position ? `${model.summary.table_position}` : '—';
  const progress = model.summary.progress_known ? `${model.summary.played}/${model.summary.total}` : `${model.summary.played} played`;
  const progressDetail = model.summary.progress_known ? `${model.summary.progress_percent}% complete` : 'Total schedule unavailable';
  const fixtureLabel = model.summary.has_next_fixture ? 'Next opponent' : 'Fixture status';
  const fixtureDetail = model.summary.has_next_fixture
    ? (model.summary.submitted ? 'Team submitted' : 'Selection required')
    : 'No selection needed';
  $('portalOverview').innerHTML = `
    <article><span>League position</span><strong>${position}</strong><small>${model.summary.points ?? '—'} pts</small></article>
    <article><span>Season progress</span><strong>${progress}</strong><small>${progressDetail}</small></article>
    <article><span>Registered squad</span><strong>${model.summary.registered}</strong><small>${model.summary.available} available</small></article>
    <article><span>${fixtureLabel}</span><strong>${escapeHtml(model.summary.next_opponent)}</strong><small>${fixtureDetail}</small></article>`;
}

function renderLegacyNextFixture(model) {
  window.requestAnimationFrame(() => {
    const card = $('nextFixtureCard');
    const summary = $('submissionSummary');
    const button = card?.closest('.panel')?.querySelector('button[data-view="tactics"]');
    if (!card || !summary || !button) return;

    if (!model.summary.has_next_fixture) {
      card.textContent = 'Schedule pending';
      summary.textContent = 'No selection needed';
      button.hidden = true;
      button.disabled = true;
      return;
    }

    card.textContent = model.summary.next_opponent;
    summary.textContent = model.summary.submitted ? 'Team submitted' : 'No team submitted';
    button.hidden = false;
    button.disabled = false;
  });
}

function renderAlerts(model) {
  if (!$('clubAlerts')) return;
  $('clubAlerts').innerHTML = model.alerts.map((alert) => `
    <button class="portal-alert ${alert.kind}" type="button" data-portal-view="${alert.view}">
      <span class="portal-alert-dot" aria-hidden="true"></span>
      <span><strong>${escapeHtml(alert.title)}</strong><small>${escapeHtml(alert.detail)}</small></span>
      <span aria-hidden="true">›</span>
    </button>`).join('');
  document.querySelectorAll('[data-portal-view]').forEach((button) => button.addEventListener('click', () => showView(button.dataset.portalView)));
}

function renderDepth(model) {
  if (!$('squadDepthCards')) return;
  $('squadDepthCards').innerHTML = model.coverage.map((row) => {
    const state = row.gap ? 'critical' : row.temporary_gap ? 'warning' : 'good';
    return `<article class="depth-card ${state}"><span>${row.group}</span><strong>${row.registered}/${row.required}</strong><small>${row.available} available${row.gap ? ` · ${row.gap} short` : row.temporary_gap ? ` · ${row.temporary_gap} temporarily short` : ' · covered'}</small></article>`;
  }).join('');
}

function renderContracts(model) {
  if (!$('contractWatchList')) return;
  $('contractWatchList').innerHTML = model.contracts.length ? model.contracts.slice(0, 8).map((row) => `
    <article class="contract-row">
      <div><strong>${escapeHtml(row.player_name)}</strong><small>${escapeHtml(row.position)}</small></div>
      <div><strong>${row.days_remaining <= 0 ? 'Expired' : `${row.days_remaining} days`}</strong><small>${new Date(row.end_at).toLocaleDateString()}</small></div>
    </article>`).join('') : '<p class="portal-empty">No contracts expire in the next 12 months.</p>';
}

function renderSeason(model) {
  const width = model.summary.progress_known ? `${Math.min(100, Math.max(0, model.summary.progress_percent))}%` : '0%';
  document.querySelectorAll('.season-progress-shell').forEach((shell) => shell.classList.toggle('unknown', !model.summary.progress_known));
  document.querySelectorAll('.season-progress-bar').forEach((bar) => { bar.style.width = width; });
  const progressText = model.summary.progress_known
    ? `${model.summary.played} of ${model.summary.total} fixtures completed`
    : `${model.summary.played} fixtures completed · total schedule unavailable`;
  if ($('seasonProgressText')) $('seasonProgressText').textContent = progressText;
  document.querySelectorAll('[data-progress-text]').forEach((node) => { node.textContent = progressText; });
  if (!$('seasonArchiveSummary')) return;
  if (!model.archive) {
    $('seasonArchiveSummary').innerHTML = '<p class="portal-empty">End-of-season awards will appear here when the season archive is created.</p>';
    return;
  }
  const rows = [
    ['Champion', model.archive.champion?.club_id],
    ['Golden Boot', model.archive.golden_boot?.player_id],
    ['Assist leader', model.archive.assist_leader?.player_id],
    ['Best attack', model.archive.best_attack?.club_id],
    ['Best defence', model.archive.best_defence?.club_id]
  ].filter(([, value]) => value);
  $('seasonArchiveSummary').innerHTML = rows.map(([label, value]) => `<div><span>${label}</span><strong>${escapeHtml(value)}</strong></div>`).join('');
}

function renderPortal(data) {
  try {
    const model = buildPortalViewModel(data);
    renderSummary(model);
    renderLegacyNextFixture(model);
    renderAlerts(model);
    renderDepth(model);
    renderContracts(model);
    renderSeason(model);
    document.documentElement.dataset.portalReady = 'true';
  } catch (error) {
    console.error('Could not render portal overview', error);
    if ($('clubAlerts')) $('clubAlerts').innerHTML = '<p class="portal-empty">Club overview could not be calculated. Existing portal controls remain available.</p>';
  }
}

window.addEventListener('tbg:portal-rendered', (event) => renderPortal(event.detail));
window.addEventListener('tbg:portal-refreshed', (event) => renderPortal(event.detail));