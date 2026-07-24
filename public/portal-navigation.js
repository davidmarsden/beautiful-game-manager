const VIEW_ALIASES = new Map([
  ['dashboard', 'dashboard'],
  ['squad', 'squad'],
  ['tactics', 'tactics'],
  ['tactics & team', 'tactics'],
  ['schedule', 'schedule'],
  ['competition', 'competitions'],
  ['competitions', 'competitions'],
  ['world', 'world']
]);

function normaliseView(value) {
  return VIEW_ALIASES.get(String(value || '').trim().toLowerCase()) || null;
}

function viewFromTarget(target) {
  const explicit = target.closest?.('[data-view]');
  if (explicit) return normaliseView(explicit.dataset.view);
  const navLink = target.closest?.('#clubNav a');
  return navLink ? normaliseView(navLink.textContent) : null;
}

export function showPortalView(viewName, { focus = false } = {}) {
  const view = normaliseView(viewName);
  if (!view) return false;
  const target = document.getElementById(`${view}View`);
  if (!target) return false;

  document.querySelectorAll('.workspace .view').forEach((panel) => {
    const active = panel === target;
    panel.classList.toggle('active', active);
    panel.hidden = !active;
  });
  document.querySelectorAll('[data-view]').forEach((control) => {
    const active = normaliseView(control.dataset.view) === view;
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

document.addEventListener('click', handleNavigation, true);
window.addEventListener('tbg:portal-rendered', () => showPortalView('dashboard'), { once: true });
