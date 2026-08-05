import './history.js';
import './history-load-recovery.js';
import './team-selection-eligibility-guard.js';

const VIEW_ALIASES = new Map([
  ['dashboard', 'dashboard'],
  ['squad', 'squad'],
  ['tactics', 'tactics'],
  ['tactics & team', 'tactics'],
  ['schedule', 'schedule'],
  ['history', 'history'],
  ['competition', 'competitions'],
  ['competitions', 'competitions'],
  ['world', 'world']
]);

function installStylesheet(href) {
  if (document.querySelector(`link[href$="${href.replace('./', '')}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.append(link);
}

function installHistoryShell() {
  installStylesheet('./history.css');
  installStylesheet('./read-only-squad.css');
  const workspace = document.querySelector('.workspace');
  const tabs = workspace?.querySelector('.tabs');
  if (tabs && !tabs.querySelector('[data-view="history"]')) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.view = 'history';
    button.textContent = 'History';
    tabs.append(button);
  }
  if (workspace && !document.getElementById('historyView')) {
    const section = document.createElement('div');
    section.id = 'historyView';
    section.className = 'view';
    section.hidden = true;
    section.innerHTML = '<div class="empty-state">Loading canonical world history…</div>';
    workspace.append(section);
  }
}

function normaliseView(value) {
  return VIEW_ALIASES.get(String(value || '').trim().toLowerCase()) || null;
}

function requestedInitialView() {
  const requested = new URLSearchParams(window.location.search).get('view');
  return normaliseView(requested) || 'dashboard';
}

function viewFromTarget(target) {
  const explicit = target.closest?.('[data-view], [data-portal-view]');
  if (explicit) return normaliseView(explicit.dataset.view || explicit.dataset.portalView);
  const navLink = target.closest?.('#clubNav a');
  return navLink ? normaliseView(navLink.textContent) : null;
}

export function showPortalView(viewName, { focus = false } = {}) {
  installHistoryShell();
  const view = normaliseView(viewName);
  if (!view) return false;
  const target = document.getElementById(`${view}View`);
  if (!target) return false;

  document.querySelectorAll('.workspace .view').forEach((panel) => {
    const active = panel === target;
    panel.classList.toggle('active', active);
    panel.hidden = !active;
  });
  document.querySelectorAll('[data-view], [data-portal-view]').forEach((control) => {
    const requestedView = control.dataset.view || control.dataset.portalView;
    const active = normaliseView(requestedView) === view;
    control.classList.toggle('active', active);
    control.setAttribute('aria-selected', String(active));
  });
  document.querySelectorAll('#clubNav a').forEach((link) => {
    const active = normaliseView(link.textContent) === view;
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });

  if (focus) target.focus?.({ preventScroll: true });
  document.dispatchEvent(new CustomEvent('tbg:view-changed', { detail: { view } }));
  return true;
}

function handleNavigation(event) {
  const view = viewFromTarget(event.target);
  if (!view) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  showPortalView(view);
}

installHistoryShell();
document.addEventListener('click', handleNavigation, true);
window.addEventListener('tbg:portal-rendered', () => {
  installHistoryShell();
  const requested = requestedInitialView();
  if (!showPortalView(requested)) showPortalView('dashboard');
}, { once: true });
