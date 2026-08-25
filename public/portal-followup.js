const NEWS_CATEGORIES = [
  ['all', 'All news'],
  ['matchdays', 'Matchdays'],
  ['transfers', 'Transfers'],
  ['managers', 'Managers'],
  ['community', 'Community']
];

const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const formatMoney = (value) => `£${Math.max(0, Number(value) || 0).toLocaleString('en-GB')}`;
let portalAuthorization = '';
let liveTransferMarket = null;
let liveTransferRefreshPromise = null;
const followupFetch = window.fetch.bind(window);

window.fetch = async (...args) => {
  const headers = args[1]?.headers || (args[0] instanceof Request ? args[0].headers : null);
  const auth = headers instanceof Headers ? headers.get('authorization') : headers?.authorization;
  if (auth) portalAuthorization = auth;
  return followupFetch(...args);
};

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

function ownLiveListings() {
  return (liveTransferMarket?.listings || []).filter((listing) => listing.is_own_listing && listing.status === 'active');
}

function liveListingFor(playerId) {
  return ownLiveListings().find((listing) => String(listing.player_id) === String(playerId)) || null;
}

function makeListPlayerAction(playerId) {
  const action = document.createElement('button');
  action.type = 'button';
  action.className = 'squad-transfer-list-action';
  action.dataset.squadListPlayer = playerId;
  action.textContent = 'List player';
  return action;
}

function makeLiveListedBadge(listing) {
  const badge = document.createElement('span');
  badge.className = 'badge transfer';
  badge.dataset.liveTransferListing = 'true';
  badge.textContent = 'Listed';
  badge.title = `Live transfer listing · ${formatMoney(listing.asking_fee || 0)}`;
  return badge;
}

function transferOnlyControls(statusCell) {
  return [...statusCell.children].filter((child) => (
    child.matches?.('.badge.neutral, .badge.transfer, [data-squad-list-player]')
  ));
}

function enhanceSquadTransferStatus() {
  const body = document.getElementById('squadRows');
  if (!body) return;
  body.querySelectorAll('tr').forEach((row) => {
    const playerLink = row.querySelector('.player-link[data-tbg-player-id]');
    const statusCell = row.lastElementChild;
    if (!playerLink || !statusCell) return;
    statusCell.dataset.transferEnhanced = 'true';
    statusCell.classList.add('squad-transfer-status-cell');
    const playerId = playerLink.dataset.tbgPlayerId || '';
    const listing = liveTransferMarket ? liveListingFor(playerId) : null;

    if (liveTransferMarket && listing) {
      transferOnlyControls(statusCell).forEach((control) => control.remove());
      statusCell.append(makeLiveListedBadge(listing));
      return;
    }

    if (liveTransferMarket) {
      statusCell.querySelectorAll('.badge.transfer, [data-squad-list-player], .badge.neutral').forEach((control) => control.remove());
      statusCell.append(makeListPlayerAction(playerId));
      return;
    }

    const neutral = statusCell.querySelector('.badge.neutral');
    const existingAction = statusCell.querySelector('[data-squad-list-player]');
    if (existingAction) {
      existingAction.dataset.squadListPlayer = playerId;
      return;
    }
    if (neutral && neutral.textContent.trim().toLowerCase() === 'not listed') {
      neutral.setAttribute('data-squad-transfer-neutral', 'true');
      neutral.replaceWith(makeListPlayerAction(playerId));
    }
  });
}

function watchSquadStatus() {
  const body = document.getElementById('squadRows');
  if (!body || body.dataset.transferStatusObserver === 'true') return;
  body.dataset.transferStatusObserver = 'true';
  const observer = new MutationObserver(() => enhanceSquadTransferStatus());
  observer.observe(body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-tbg-player-id']
  });
  enhanceSquadTransferStatus();
}

function updateListedSummaryCount(listingCount) {
  const status = document.getElementById('transferNegotiationStatus');
  if (!status) return;
  const current = status.textContent || '';
  if (/\d+\s+incoming\s+·\s+\d+\s+outgoing\s+·\s+\d+\s+listed/.test(current)) {
    status.textContent = current.replace(/·\s+\d+\s+listed\s*$/, `· ${listingCount} listed`);
  }
}

function renderLiveTransferListings() {
  const target = document.getElementById('activeTransferListings');
  if (!target || !liveTransferMarket) return;
  const listings = ownLiveListings();
  const snapshot = listings.map((listing) => `${listing.player_id}:${listing.updated_at || ''}:${listing.asking_fee || 0}`).join('|');
  if (target.dataset.liveListingSnapshot !== snapshot) {
    target.dataset.liveListingSnapshot = snapshot;
    target.innerHTML = listings.length ? listings.map((listing) => `
      <article class="incoming-transfer-offer">
        <div><strong>${escapeHtml(listing.player_name || listing.player_id)}</strong><span>Listed for ${formatMoney(listing.asking_fee || 0)}</span><small>Live now · updated ${escapeHtml(new Date(listing.updated_at).toLocaleString('en-GB'))}</small></div>
        <div class="world-control-actions"><button type="button" data-withdraw-listing data-player-id="${escapeHtml(listing.player_id)}">Withdraw listing</button></div>
      </article>`).join('') : '<p>No players are currently transfer listed.</p>';
  }
  updateListedSummaryCount(listings.length);
}

async function refreshLiveTransferPresentation() {
  if (!portalAuthorization) return null;
  if (liveTransferRefreshPromise) return liveTransferRefreshPromise;
  liveTransferRefreshPromise = followupFetch('/api/transfer-deals', {
    headers: { authorization: portalAuthorization },
    cache: 'no-store'
  }).then(async (response) => {
    if (!response.ok) throw new Error(`Transfer market refresh failed (${response.status})`);
    liveTransferMarket = await response.json();
    enhanceSquadTransferStatus();
    renderLiveTransferListings();
    return liveTransferMarket;
  }).finally(() => { liveTransferRefreshPromise = null; });
  return liveTransferRefreshPromise;
}

function transferMutationMessage(text) {
  return /Player listed immediately|Transfer listing withdrawn immediately/i.test(String(text || ''));
}

function watchTransferMutationCompletion() {
  const message = document.getElementById('transferNegotiationMessage');
  if (!message || message.dataset.liveListingObserver === 'true') return;
  message.dataset.liveListingObserver = 'true';
  let lastText = message.textContent || '';
  const observer = new MutationObserver(() => {
    const text = message.textContent || '';
    if (text !== lastText && transferMutationMessage(text)) {
      lastText = text;
      queueMicrotask(() => refreshLiveTransferPresentation().catch(() => {}));
    } else {
      lastText = text;
    }
  });
  observer.observe(message, { childList: true, characterData: true, subtree: true });
}

function retryTransferListing(playerId, attempt) {
  if (attempt < 30) setTimeout(() => prepareTransferListing(playerId, attempt + 1), 50);
}

function prepareTransferListing(playerId, attempt = 0) {
  const action = document.getElementById('negotiationAction');
  const player = document.getElementById('negotiationPlayer');
  if (!action || !player || !playerId) {
    retryTransferListing(playerId, attempt);
    return;
  }

  action.value = 'listing';
  action.dispatchEvent(new Event('change', { bubbles: true }));
  queueMicrotask(() => {
    const refreshedPlayer = document.getElementById('negotiationPlayer');
    const requestedOption = refreshedPlayer
      ? [...refreshedPlayer.options].find((option) => option.value === playerId)
      : null;
    if (!refreshedPlayer || !requestedOption) {
      retryTransferListing(playerId, attempt);
      return;
    }

    refreshedPlayer.value = playerId;
    if (refreshedPlayer.value !== playerId) {
      retryTransferListing(playerId, attempt);
      return;
    }

    document.querySelector('[data-transfer-section="my"]')?.click();
    document.querySelector('.transfer-negotiation-compose')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}

document.addEventListener('click', (event) => {
  const button = event.target.closest?.('[data-squad-list-player]');
  if (!button) return;
  event.preventDefault();
  document.querySelector('[data-view="transfers"]')?.click();
  prepareTransferListing(button.dataset.squadListPlayer || '');
});

installStylesheet();
watchNewsFeed();
watchSquadStatus();
document.addEventListener('tbg:view-changed', (event) => {
  if (event.detail?.view === 'feed') queueMicrotask(() => {
    watchNewsFeed();
    installNewsCategories();
  });
  if (event.detail?.view === 'squad') queueMicrotask(() => {
    watchSquadStatus();
    refreshLiveTransferPresentation().catch(() => enhanceSquadTransferStatus());
  });
  if (event.detail?.view === 'transfers') queueMicrotask(() => {
    watchTransferMutationCompletion();
    refreshLiveTransferPresentation().catch(() => {});
  });
});
window.addEventListener('tbg:portal-rendered', () => {
  watchNewsFeed();
  installNewsCategories();
  watchSquadStatus();
  enhanceSquadTransferStatus();
  watchTransferMutationCompletion();
  queueMicrotask(() => refreshLiveTransferPresentation().catch(() => {}));
});
