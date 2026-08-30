const ACTIVITY_INTERVAL = 5 * 60_000;
let lastActivityTouch = 0;
let activityRequest = null;

function installStylesheet(href) {
  if (document.querySelector(`link[href$="${href.replace('./', '')}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.append(link);
}

function authToken() {
  const bridged = String(window.tbgPortalAuthorization || '').trim();
  if (bridged) return bridged.toLowerCase().startsWith('bearer ') ? bridged.slice(7).trim() : bridged;
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

async function touchManagerActivity({ force = false } = {}) {
  if (document.visibilityState === 'hidden') return;
  const now = Date.now();
  if (!force && now - lastActivityTouch < ACTIVITY_INTERVAL) return;
  if (activityRequest) return activityRequest;
  const token = authToken();
  if (!token) return;
  lastActivityTouch = now;
  activityRequest = fetch('/api/manager-participation', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'touch-activity' })
  }).catch(() => null).finally(() => { activityRequest = null; });
  return activityRequest;
}

function tabShell() {
  return document.querySelector('.portal-tabs-scroll-shell');
}

function updateTabScroller() {
  const shell = tabShell();
  const tabs = shell?.querySelector('.tabs');
  if (!shell || !tabs) return;
  const max = Math.max(0, tabs.scrollWidth - tabs.clientWidth);
  const overflow = max > 2;
  const canLeft = overflow && tabs.scrollLeft > 2;
  const canRight = overflow && tabs.scrollLeft < max - 2;
  shell.classList.toggle('portal-tabs-can-left', canLeft);
  shell.classList.toggle('portal-tabs-can-right', canRight);
  shell.querySelector('[data-tabs-scroll="left"]')?.toggleAttribute('hidden', !canLeft);
  shell.querySelector('[data-tabs-scroll="right"]')?.toggleAttribute('hidden', !canRight);
}

function scrollTabs(direction) {
  const tabs = tabShell()?.querySelector('.tabs');
  if (!tabs) return;
  tabs.scrollBy({ left: direction * Math.max(180, tabs.clientWidth * 0.7), behavior: 'smooth' });
}

function revealActiveTab({ smooth = true } = {}) {
  const tabs = tabShell()?.querySelector('.tabs');
  const active = tabs?.querySelector('[data-view].active');
  if (!tabs || !active) return;
  const desired = active.offsetLeft - ((tabs.clientWidth - active.offsetWidth) / 2);
  const max = Math.max(0, tabs.scrollWidth - tabs.clientWidth);
  tabs.scrollTo({ left: Math.max(0, Math.min(max, desired)), behavior: smooth ? 'smooth' : 'auto' });
  window.setTimeout(updateTabScroller, smooth ? 250 : 0);
}

function installTabScroller() {
  installStylesheet('./portal-presence.css');
  const tabs = document.querySelector('.workspace .tabs');
  if (!tabs) return;
  if (!tabs.closest('.portal-tabs-scroll-shell')) {
    const shell = document.createElement('div');
    shell.className = 'portal-tabs-scroll-shell';
    tabs.before(shell);
    shell.append(tabs);

    const left = document.createElement('button');
    left.type = 'button';
    left.className = 'portal-tabs-scroll-button portal-tabs-scroll-left';
    left.dataset.tabsScroll = 'left';
    left.setAttribute('aria-label', 'Scroll menu left');
    left.innerHTML = '<span aria-hidden="true">‹</span>';
    left.hidden = true;

    const right = document.createElement('button');
    right.type = 'button';
    right.className = 'portal-tabs-scroll-button portal-tabs-scroll-right';
    right.dataset.tabsScroll = 'right';
    right.setAttribute('aria-label', 'Scroll menu right for more pages');
    right.innerHTML = '<span aria-hidden="true">›</span>';
    right.hidden = true;

    shell.append(left, right);
    left.addEventListener('click', () => scrollTabs(-1));
    right.addEventListener('click', () => scrollTabs(1));
    tabs.addEventListener('scroll', updateTabScroller, { passive: true });
    new MutationObserver(() => requestAnimationFrame(updateTabScroller)).observe(tabs, { childList: true });
  }
  requestAnimationFrame(() => {
    updateTabScroller();
    revealActiveTab({ smooth: false });
  });
}

window.addEventListener('resize', updateTabScroller, { passive: true });
window.addEventListener('tbg:portal-rendered', () => {
  installTabScroller();
  void touchManagerActivity({ force: true });
});
document.addEventListener('tbg:view-changed', () => {
  installTabScroller();
  revealActiveTab();
  void touchManagerActivity();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void touchManagerActivity();
});
document.addEventListener('pointerdown', () => { void touchManagerActivity(); }, { passive: true });
document.addEventListener('keydown', () => { void touchManagerActivity(); }, { passive: true });

installTabScroller();

export { installTabScroller, touchManagerActivity, updateTabScroller };
