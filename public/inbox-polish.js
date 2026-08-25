const INBOX_FILTERS = [
  ['all', 'All messages'],
  ['unread', 'Unread'],
  ['high', 'High priority'],
  ['normal', 'Normal']
];

function installInboxStylesheet() {
  if (document.querySelector('link[href$="inbox-polish.css"]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = './inbox-polish.css';
  document.head.append(link);
}

function inboxPriority(card) {
  return String(card.querySelector('.message-heading>span')?.textContent || '').trim().toLowerCase();
}

function inboxMatches(card, filter) {
  if (filter === 'all') return true;
  if (filter === 'unread') return card.classList.contains('unread');
  return inboxPriority(card) === filter;
}

function inboxCounts(list) {
  const cards = [...list.querySelectorAll('.inbox-message[data-message-id]')];
  return new Map([
    ['all', cards.length],
    ['unread', cards.filter((card) => card.classList.contains('unread')).length],
    ['high', cards.filter((card) => inboxPriority(card) === 'high').length],
    ['normal', cards.filter((card) => inboxPriority(card) === 'normal').length]
  ]);
}

function applyInboxFilter(root, filter) {
  const list = root?.querySelector('#inboxList');
  if (!list) return;
  let visible = 0;
  list.querySelectorAll('.inbox-message[data-message-id]').forEach((card) => {
    const priority = inboxPriority(card);
    card.dataset.inboxPriority = priority || 'normal';
    const show = inboxMatches(card, filter);
    card.hidden = !show;
    if (show) visible += 1;
  });

  root.querySelectorAll('.inbox-filter-tab').forEach((tab) => {
    const active = tab.dataset.inboxFilter === filter;
    tab.setAttribute('aria-pressed', String(active));
  });

  const empty = root.querySelector('.inbox-filter-empty');
  if (empty) {
    empty.textContent = filter === 'all' ? 'No messages yet.' : 'No messages in this view.';
    empty.hidden = visible > 0;
  }
}

function refreshInboxControls(root) {
  const list = root?.querySelector('#inboxList');
  const nav = root?.querySelector('.inbox-filter-tabs');
  if (!list || !nav) return;
  const counts = inboxCounts(list);
  nav.querySelectorAll('.inbox-filter-tab').forEach((tab) => {
    const count = String(counts.get(tab.dataset.inboxFilter) || 0);
    const node = tab.querySelector('small');
    if (node && node.textContent !== count) node.textContent = count;
  });
  const active = nav.querySelector('.inbox-filter-tab[aria-pressed="true"]')?.dataset.inboxFilter || 'all';
  applyInboxFilter(root, active);
}

function installInboxControls() {
  const root = document.getElementById('dashboardView');
  const list = root?.querySelector('#inboxList');
  const heading = root?.querySelector('.inbox-heading');
  if (!root || !list || !heading) return;

  heading.classList.add('inbox-hero');
  const titleWrap = heading.querySelector('.inbox-title-wrap') || (() => {
    const wrap = document.createElement('div');
    wrap.className = 'inbox-title-wrap';
    const title = heading.querySelector('h2');
    if (title) {
      title.before(wrap);
      wrap.append(title);
    } else {
      heading.prepend(wrap);
    }
    const subtitle = document.createElement('p');
    subtitle.textContent = 'Club notices, transfer decisions and world administration in one place.';
    wrap.append(subtitle);
    return wrap;
  })();
  if (!titleWrap.querySelector('p')) {
    const subtitle = document.createElement('p');
    subtitle.textContent = 'Club notices, transfer decisions and world administration in one place.';
    titleWrap.append(subtitle);
  }

  let nav = root.querySelector('.inbox-filter-tabs');
  if (!nav) {
    nav = document.createElement('nav');
    nav.className = 'inbox-filter-tabs';
    nav.setAttribute('aria-label', 'Inbox filters');
    INBOX_FILTERS.forEach(([key, label]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'inbox-filter-tab';
      button.dataset.inboxFilter = key;
      button.setAttribute('aria-pressed', String(key === 'all'));
      button.innerHTML = `<strong>${label}</strong><small>0</small>`;
      button.addEventListener('click', () => applyInboxFilter(root, key));
      nav.append(button);
    });
    const status = root.querySelector('#inboxStatus');
    (status || heading).after(nav);

    const empty = document.createElement('p');
    empty.className = 'inbox-filter-empty';
    empty.hidden = true;
    nav.after(empty);
  }

  if (list.dataset.inboxPolishObserver !== 'true') {
    list.dataset.inboxPolishObserver = 'true';
    const observer = new MutationObserver(() => refreshInboxControls(root));
    observer.observe(list, { childList: true });
  }
  refreshInboxControls(root);
}

installInboxStylesheet();
installInboxControls();
window.addEventListener('load', () => queueMicrotask(installInboxControls));
window.addEventListener('tbg:portal-rendered', () => queueMicrotask(installInboxControls));
document.addEventListener('tbg:view-changed', (event) => {
  if (event.detail?.view === 'dashboard') queueMicrotask(installInboxControls);
});
