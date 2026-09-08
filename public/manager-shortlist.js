const shortlistEscape = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));

let shortlistItems = [];
let shortlistLoaded = false;
let shortlistLoading = null;
let shortlistObserver = null;
let shortlistActive = false;

function shortlistToken() {
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

async function shortlistRequest(body = null) {
  const token = shortlistToken();
  if (!token) throw new Error('Sign in to use your shortlist.');
  const response = await fetch('/api/shortlist', {
    method: body ? 'POST' : 'GET',
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || data.code || `Shortlist request failed (HTTP ${response.status})`);
  return data;
}

function ensureShortlistStyles() {
  if (document.getElementById('tbgShortlistStyles')) return;
  const style = document.createElement('style');
  style.id = 'tbgShortlistStyles';
  style.textContent = `
    .shortlist-toggle{min-width:2.4rem;font-size:1.05rem}.shortlist-toggle[aria-pressed="true"]{font-weight:800}
    .shortlist-intro{margin:0 0 .8rem;max-width:72ch}.shortlist-results{display:grid;gap:.65rem}
    .shortlist-card{padding:.8rem;border:1px solid var(--border,#dedede);border-radius:10px;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:.75rem 1rem;align-items:start}
    .shortlist-card strong,.shortlist-card small{display:block}.shortlist-card small{opacity:.8;margin-top:.18rem}
    .shortlist-note{grid-column:1/-1;display:grid;gap:.35rem}.shortlist-note textarea{width:100%;min-height:3.2rem;resize:vertical}
    .shortlist-actions{display:flex;gap:.45rem;flex-wrap:wrap;justify-content:flex-end}.shortlist-message{min-height:1.2em}
    @media(max-width:720px){.shortlist-card{grid-template-columns:1fr}.shortlist-actions{justify-content:flex-start}.shortlist-note{grid-column:1}}
  `;
  document.head.append(style);
}

function shortlistIds() {
  return new Set(shortlistItems.map((item) => String(item.player_id)));
}

function setShortlistStatus(message) {
  const host = document.getElementById('shortlistMessage');
  if (host) host.textContent = message || '';
}

async function loadShortlist({ force = false } = {}) {
  if (shortlistLoading) return shortlistLoading;
  if (shortlistLoaded && !force) return shortlistItems;
  shortlistLoading = (async () => {
    const data = await shortlistRequest();
    shortlistItems = Array.isArray(data.items) ? data.items : [];
    shortlistLoaded = true;
    decorateOpenMarketCards();
    if (shortlistActive) renderShortlist();
    return shortlistItems;
  })().finally(() => { shortlistLoading = null; });
  return shortlistLoading;
}

function snapshotFromCard(card, sourceType) {
  const strong = card.querySelector('strong')?.textContent?.trim() || '';
  if (sourceType === 'listed') {
    const offer = card.querySelector('[data-open-market-prepare-offer]');
    const detail = card.querySelector('small')?.textContent || '';
    const rating = detail.match(/Rating\s+([^·]+)/i)?.[1]?.trim();
    const position = detail.split('·')[0]?.trim();
    return {
      display_name: strong,
      club_name: offer?.dataset.clubName || '',
      asking_fee: Number(offer?.dataset.fee || 0),
      position,
      rating: rating || undefined
    };
  }
  const sign = card.querySelector('[data-sign-free-agent]');
  const line = card.querySelector('span')?.textContent || '';
  const age = line.match(/Age\s+(\d+)/i)?.[1];
  const rating = line.match(/Rating\s+([^·]+)/i)?.[1]?.trim();
  const position = line.split('·')[0]?.trim();
  return {
    display_name: strong,
    position,
    age: age ? Number(age) : undefined,
    rating: rating || undefined,
    transfermarkt_id: sign?.dataset.tmId || ''
  };
}

function playerIdentityFromCard(card) {
  const listing = card.querySelector('[data-open-market-prepare-offer]');
  if (listing?.dataset.playerId) {
    return { playerId: listing.dataset.playerId, sourceType: 'listed', snapshot: snapshotFromCard(card, 'listed') };
  }
  const freeAgentId = card.dataset.freeAgentCard;
  if (freeAgentId) {
    return { playerId: freeAgentId, sourceType: 'free_agent', snapshot: snapshotFromCard(card, 'free_agent') };
  }
  return null;
}

function decorateOpenMarketCards() {
  const workspace = document.getElementById('openMarketWorkspace');
  if (!workspace) return;
  const saved = shortlistIds();
  workspace.querySelectorAll('.open-market-card').forEach((card) => {
    const identity = playerIdentityFromCard(card);
    if (!identity) return;
    let button = card.querySelector('[data-shortlist-toggle]');
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'shortlist-toggle';
      button.dataset.shortlistToggle = identity.playerId;
      button.dataset.shortlistSource = identity.sourceType;
      button.title = 'Add to shortlist';
      const actions = card.querySelector('.open-market-actions') || card;
      actions.insertBefore(button, actions.firstChild);
    }
    const selected = saved.has(String(identity.playerId));
    button.setAttribute('aria-pressed', String(selected));
    button.setAttribute('aria-label', selected ? 'Remove from shortlist' : 'Add to shortlist');
    button.title = selected ? 'Remove from shortlist' : 'Add to shortlist';
    button.textContent = selected ? '★' : '☆';
  });
}

function mountShortlist() {
  const workspace = document.getElementById('openMarketWorkspace');
  if (!workspace) return false;
  ensureShortlistStyles();
  const tabs = workspace.querySelector('.open-market-tabs');
  const marketPanel = document.getElementById('openMarketPanel');
  if (!tabs || !marketPanel) return false;

  if (!tabs.querySelector('[data-shortlist-tab]')) {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.setAttribute('role', 'tab');
    tab.dataset.shortlistTab = 'true';
    tab.setAttribute('aria-selected', 'false');
    tab.textContent = 'Shortlist';
    tabs.append(tab);
  }

  if (!document.getElementById('shortlistPanel')) {
    const panel = document.createElement('div');
    panel.id = 'shortlistPanel';
    panel.className = 'open-market-panel';
    panel.hidden = true;
    marketPanel.after(panel);
  }

  if (shortlistObserver) shortlistObserver.disconnect();
  shortlistObserver = new MutationObserver(() => decorateOpenMarketCards());
  shortlistObserver.observe(workspace, { childList: true, subtree: true });
  decorateOpenMarketCards();
  loadShortlist().catch(() => {});
  return true;
}

function shortlistSummary(snapshot = {}) {
  const parts = [];
  if (snapshot.position) parts.push(snapshot.position);
  if (snapshot.age != null) parts.push(`Age ${snapshot.age}`);
  if (snapshot.rating != null && snapshot.rating !== '') parts.push(`Rating ${snapshot.rating}`);
  if (snapshot.club_name) parts.push(snapshot.club_name);
  if (snapshot.asking_fee != null && Number(snapshot.asking_fee) > 0) parts.push(`£${Number(snapshot.asking_fee).toLocaleString('en-GB')}`);
  if (snapshot.market_value_eur != null) parts.push(`TM €${Number(snapshot.market_value_eur).toLocaleString('en-GB')}`);
  return parts.join(' · ');
}

function sourceAction(item) {
  const id = String(item.player_id || '');
  const source = item.source_type || 'unknown';
  const exactOffer = [...document.querySelectorAll('[data-open-market-prepare-offer]')]
    .find((button) => String(button.dataset.playerId || '') === id);
  if (exactOffer) return `<button type="button" data-shortlist-market-action="offer" data-player-id="${shortlistEscape(id)}">Make offer</button>`;
  if (source === 'free_agent') return `<button type="button" data-shortlist-market-action="free-agents">Open free agents</button>`;
  if (source === 'external') return `<button type="button" data-shortlist-market-action="external">Open external search</button>`;
  return `<button type="button" data-shortlist-market-action="listed">Open transfer market</button>`;
}

function renderShortlist() {
  const panel = document.getElementById('shortlistPanel');
  if (!panel) return;
  if (!shortlistLoaded) {
    panel.innerHTML = '<p class="shortlist-intro">Loading your shortlist…</p>';
    return;
  }
  panel.innerHTML = `
    <p class="shortlist-intro"><strong>Your recruitment shortlist</strong><br><small>Shortlisting is private and reveals nothing new about a player. It only remembers information you had already seen.</small></p>
    <p id="shortlistMessage" class="shortlist-message" aria-live="polite"></p>
    <div class="shortlist-results">
      ${shortlistItems.length ? shortlistItems.map((item) => {
        const snapshot = item.player_snapshot || {};
        return `<article class="shortlist-card" data-shortlist-card="${shortlistEscape(item.player_id)}">
          <div><strong>${shortlistEscape(snapshot.display_name || item.player_id)}</strong><small>${shortlistEscape(shortlistSummary(snapshot) || 'No additional details saved')}</small><small>Shortlisted ${shortlistEscape(new Date(item.created_at).toLocaleDateString('en-GB'))}</small></div>
          <div class="shortlist-actions">${sourceAction(item)}<button type="button" data-shortlist-remove="${shortlistEscape(item.player_id)}">Remove</button></div>
          <label class="shortlist-note">Private note<textarea maxlength="1000" data-shortlist-note="${shortlistEscape(item.player_id)}" placeholder="e.g. D2 RB option; watch if relegated">${shortlistEscape(item.note || '')}</textarea><span><button type="button" data-shortlist-save-note="${shortlistEscape(item.player_id)}">Save note</button></span></label>
        </article>`;
      }).join('') : '<p class="open-market-empty">No players shortlisted yet. Use ☆ beside a player in the transfer market to remember them here.</p>'}
    </div>`;
}

async function toggleShortlist(button) {
  const card = button.closest('.open-market-card');
  const identity = card && playerIdentityFromCard(card);
  if (!identity) return;
  const exists = shortlistIds().has(String(identity.playerId));
  button.disabled = true;
  try {
    if (exists) {
      await shortlistRequest({ action: 'remove', player_id: identity.playerId });
      shortlistItems = shortlistItems.filter((item) => String(item.player_id) !== String(identity.playerId));
    } else {
      await shortlistRequest({
        action: 'upsert',
        player_id: identity.playerId,
        source_type: identity.sourceType,
        player_snapshot: identity.snapshot
      });
      shortlistLoaded = false;
      await loadShortlist({ force: true });
    }
    decorateOpenMarketCards();
    if (shortlistActive) renderShortlist();
  } finally {
    button.disabled = false;
  }
}

function openMarketTab(name) {
  shortlistActive = false;
  const shortlistPanel = document.getElementById('shortlistPanel');
  const marketPanel = document.getElementById('openMarketPanel');
  if (shortlistPanel) shortlistPanel.hidden = true;
  if (marketPanel) marketPanel.hidden = false;
  const tab = document.querySelector(`[data-open-market-tab="${name}"]`);
  if (tab) tab.click();
}

document.addEventListener('click', async (event) => {
  const shortlistTab = event.target.closest('[data-shortlist-tab]');
  if (shortlistTab) {
    event.preventDefault();
    shortlistActive = true;
    document.querySelectorAll('#openMarketWorkspace [role="tab"]').forEach((tab) => tab.setAttribute('aria-selected', String(tab === shortlistTab)));
    const marketPanel = document.getElementById('openMarketPanel');
    const panel = document.getElementById('shortlistPanel');
    if (marketPanel) marketPanel.hidden = true;
    if (panel) panel.hidden = false;
    renderShortlist();
    loadShortlist({ force: true }).catch((error) => setShortlistStatus(error.message));
    return;
  }

  if (event.target.closest('[data-open-market-tab]')) {
    shortlistActive = false;
    const panel = document.getElementById('shortlistPanel');
    const marketPanel = document.getElementById('openMarketPanel');
    if (panel) panel.hidden = true;
    if (marketPanel) marketPanel.hidden = false;
    document.querySelector('[data-shortlist-tab]')?.setAttribute('aria-selected', 'false');
    setTimeout(decorateOpenMarketCards, 0);
    return;
  }

  const toggle = event.target.closest('[data-shortlist-toggle]');
  if (toggle) {
    event.preventDefault();
    toggleShortlist(toggle).catch((error) => { console.error('Could not update shortlist', error); });
    return;
  }

  const remove = event.target.closest('[data-shortlist-remove]');
  if (remove) {
    const playerId = remove.dataset.shortlistRemove;
    remove.disabled = true;
    try {
      await shortlistRequest({ action: 'remove', player_id: playerId });
      shortlistItems = shortlistItems.filter((item) => String(item.player_id) !== String(playerId));
      renderShortlist();
      decorateOpenMarketCards();
      setShortlistStatus('Removed from shortlist.');
    } catch (error) {
      setShortlistStatus(error.message);
      remove.disabled = false;
    }
    return;
  }

  const save = event.target.closest('[data-shortlist-save-note]');
  if (save) {
    const playerId = save.dataset.shortlistSaveNote;
    const item = shortlistItems.find((candidate) => String(candidate.player_id) === String(playerId));
    const note = document.querySelector(`[data-shortlist-note="${CSS.escape(playerId)}"]`)?.value || '';
    save.disabled = true;
    try {
      await shortlistRequest({
        action: 'upsert',
        player_id: playerId,
        source_type: item?.source_type || 'unknown',
        player_snapshot: item?.player_snapshot || {},
        note
      });
      if (item) item.note = note.trim();
      setShortlistStatus('Private note saved.');
    } catch (error) {
      setShortlistStatus(error.message);
    } finally {
      save.disabled = false;
    }
    return;
  }

  const marketAction = event.target.closest('[data-shortlist-market-action]');
  if (marketAction) {
    const action = marketAction.dataset.shortlistMarketAction;
    if (action === 'offer') {
      const id = marketAction.dataset.playerId;
      const offer = [...document.querySelectorAll('[data-open-market-prepare-offer]')]
        .find((button) => String(button.dataset.playerId || '') === String(id));
      if (offer) {
        openMarketTab('listed');
        setTimeout(() => offer.click(), 0);
        return;
      }
    }
    openMarketTab(action === 'free-agents' || action === 'external' ? action : 'listed');
  }
});

window.addEventListener('tbg:view-changed', (event) => {
  if (event.detail?.view !== 'transfers') return;
  setTimeout(mountShortlist, 0);
  setTimeout(mountShortlist, 150);
});

window.addEventListener('tbg:portal-rendered', () => {
  setTimeout(mountShortlist, 0);
});

setTimeout(mountShortlist, 0);
