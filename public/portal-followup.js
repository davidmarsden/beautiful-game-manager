const NEWS_CATEGORIES = [
  ['all', 'All news'],
  ['matchdays', 'Matchdays'],
  ['transfers', 'Transfers'],
  ['managers', 'Managers'],
  ['community', 'Community']
];

function installStylesheet() {
  if (document.querySelector('link[href$="portal-followup.css"]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = './portal-followup.css';
  document.head.append(link);
}

function categoryForCard(card) {
  if (card.classList.contains('world-feed-transfer_completed')) return 'transfers';
  if (card.classList.contains('world-feed-manager_post')) return 'community';
  if (card.classList.contains('world-feed-manager_appointment')) return 'managers';
  if (
    card.classList.contains('world-feed-matchday_upcoming')
    || card.classList.contains('world-feed-matchday_completed')
    || card.classList.contains('world-feed-matchday_press_conference')
  ) return 'matchdays';
  return 'all';
}

function applyNewsCategory(root, category) {
  const cards = [...root.querySelectorAll('.world-feed-list .world-feed-item')];
  let visible = 0;
  cards.forEach((card) => {
    const show = category === 'all' || categoryForCard(card) === category;
    card.hidden = !show;
    if (show) visible += 1;
  });

  root.querySelectorAll('.world-feed-category-tab').forEach((tab) => {
    const active = tab.dataset.newsCategory === category;
    tab.setAttribute('aria-pressed', String(active));
    tab.classList.toggle('active', active);
  });

  let empty = root.querySelector('.world-feed-category-empty');
  if (!empty) {
    empty = document.createElement('p');
    empty.className = 'world-feed-category-empty';
    root.querySelector('.world-feed-list')?.append(empty);
  }
  const emptyText = category === 'all' ? 'No world activity yet.' : 'Nothing in this news category yet.';
  if (empty.textContent !== emptyText) empty.textContent = emptyText;
  empty.hidden = visible > 0;
}

function categoryCounts(list) {
  const cards = [...list.querySelectorAll('.world-feed-item')];
  const counts = new Map(NEWS_CATEGORIES.map(([key]) => [key, 0]));
  counts.set('all', cards.length);
  cards.forEach((card) => {
    const category = categoryForCard(card);
    if (category !== 'all') counts.set(category, (counts.get(category) || 0) + 1);
  });
  return counts;
}

function refreshNewsCategories(root) {
  const list = root?.querySelector('.world-feed-list');
  const nav = root?.querySelector('.world-feed-category-tabs');
  if (!list || !nav) return;
  const counts = categoryCounts(list);
  nav.querySelectorAll('.world-feed-category-tab').forEach((tab) => {
    const count = String(counts.get(tab.dataset.newsCategory) || 0);
    const countNode = tab.querySelector('small');
    if (countNode && countNode.textContent !== count) countNode.textContent = count;
  });
  const active = nav.querySelector('.world-feed-category-tab[aria-pressed="true"]')?.dataset.newsCategory || 'all';
  applyNewsCategory(root, active);
}

function installNewsCategories() {
  const root = document.getElementById('feedView');
  const shell = root?.querySelector('.world-feed-shell');
  const list = shell?.querySelector('.world-feed-list');
  if (!shell || !list) return;
  if (shell.querySelector('.world-feed-category-tabs')) {
    refreshNewsCategories(root);
    return;
  }

  const counts = categoryCounts(list);
  const nav = document.createElement('nav');
  nav.className = 'world-feed-category-tabs';
  nav.setAttribute('aria-label', 'News categories');
  NEWS_CATEGORIES.forEach(([key, label]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'world-feed-category-tab';
    button.dataset.newsCategory = key;
    button.innerHTML = `<strong>${label}</strong><small>${counts.get(key) || 0}</small>`;
    button.addEventListener('click', () => applyNewsCategory(root, key));
    nav.append(button);
  });

  const composer = shell.querySelector('.world-feed-composer');
  if (composer) composer.after(nav);
  else shell.querySelector('.world-feed-heading')?.after(nav);
  applyNewsCategory(root, 'all');
}

function mutationContainsFeedCard(mutation) {
  const nodes = [...mutation.addedNodes, ...mutation.removedNodes];
  return nodes.some((node) => node.nodeType === Node.ELEMENT_NODE && (
    node.matches?.('.world-feed-item, .world-feed-list, .world-feed-shell')
    || node.querySelector?.('.world-feed-item')
  ));
}

function watchNewsFeed() {
  const root = document.getElementById('feedView');
  if (!root || root.dataset.newsCategoryObserver === 'true') return;
  root.dataset.newsCategoryObserver = 'true';
  const observer = new MutationObserver((mutations) => {
    if (mutations.some(mutationContainsFeedCard)) installNewsCategories();
  });
  observer.observe(root, { childList: true, subtree: true });
  installNewsCategories();
}

installStylesheet();
watchNewsFeed();
document.addEventListener('tbg:view-changed', (event) => {
  if (event.detail?.view === 'feed') queueMicrotask(() => {
    watchNewsFeed();
    installNewsCategories();
  });
});
window.addEventListener('tbg:portal-rendered', () => {
  watchNewsFeed();
  installNewsCategories();
});
