import { buildPortalViewModel } from './portal-v1-model.js';

const $ = (id) => document.getElementById(id);
const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));

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
  const progress = model.summary.total ? `${model.summary.played}/${model.summary.total}` : `${model.summary.played}`;
  $('portalOverview').innerHTML = `
    <article><span>League position</span><strong>${position}</strong><small>${model.summary.points ?? '—'} pts</small></article>
    <article><span>Season progress</span><strong>${progress}</strong><small>${model.summary.progress_percent}% complete</small></article>
    <article><span>Registered squad</span><strong>${model.summary.registered}</strong><small>${model.summary.available} available</small></article>
    <article><span>Next opponent</span><strong>${escapeHtml(model.summary.next_opponent)}</strong><small>${model.summary.submitted ? 'Team submitted' : 'Selection required'}</small></article>`;
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
  if ($('seasonProgressBar')) $('seasonProgressBar').style.width = `${Math.min(100, Math.max(0, model.summary.progress_percent))}%`;
  if ($('seasonProgressText')) $('seasonProgressText').textContent = model.summary.total ? `${model.summary.played} of ${model.summary.total} fixtures completed` : `${model.summary.played} fixtures completed`;
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
