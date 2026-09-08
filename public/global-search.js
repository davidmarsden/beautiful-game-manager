import { openTbgPlayerProfile } from './player-profile.js';
import { openClubInspection } from './club-inspection.js';
import { shortlistResults } from './player-profile-actions.js';

let activeRequest = 0;
let selectedIndex = -1;
let latestResults = [];

function accessToken() {
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

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[character]));

function ensureStyles() {
  if (document.querySelector('link[data-tbg-global-search]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = './global-search.css';
  link.dataset.tbgGlobalSearch = 'true';
  document.head.append(link);
}

function searchHost() {
  return document.getElementById('tbgGlobalSearch');
}

function closeResults() {
  const panel = searchHost()?.querySelector('[data-global-search-results]');
  if (panel) {
    panel.hidden = true;
    panel.innerHTML = '';
  }
  latestResults = [];
  selectedIndex = -1;
}

function updateSelection() {
  searchHost()?.querySelectorAll('[data-global-search-index]').forEach((button, index) => {
    const selected = index === selectedIndex;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-selected', String(selected));
    if (selected) button.scrollIntoView({ block: 'nearest' });
  });
}

function resultMarkup(result, index) {
  const label = result.type === 'club' ? 'CLUB' : result.type === 'external-player' ? 'EXTERNAL' : 'PLAYER';
  return `<button type="button" role="option" aria-selected="false" data-global-search-index="${index}">
    <span class="global-search-type">${label}</span>
    <span class="global-search-name">${escapeHtml(result.name)}</span>
    <small>${escapeHtml(result.secondary || '')}</small>
  </button>`;
}

function renderResults(results, message = '') {
  const panel = searchHost()?.querySelector('[data-global-search-results]');
  if (!panel) return;
  latestResults = Array.isArray(results) ? results : [];
  selectedIndex = latestResults.length ? 0 : -1;
  panel.hidden = false;
  panel.innerHTML = latestResults.length
    ? latestResults.map(resultMarkup).join('')
    : `<div class="global-search-empty">${escapeHtml(message || 'No matching players or clubs.')}</div>`;
  updateSelection();
}

function openTransfers() {
  document.querySelector('[data-view="transfers"]')?.click();
}

async function activate(result) {
  if (!result) return;
  closeResults();
  const input = searchHost()?.querySelector('input');
  if (result.type === 'player') {
    openTbgPlayerProfile(document.body, result.player, result.club || {});
  } else if (result.type === 'club') {
    await openClubInspection(result.id);
  } else if (result.type === 'external-player') {
    openTransfers();
    window.setTimeout(() => document.dispatchEvent(new CustomEvent('tbg:open-external-player', {
      detail: { transfermarktId: result.transfermarkt_id, player: result.external_player }
    })), 50);
  }
  if (input) input.value = result.name || input.value;
}

function externalResults(data) {
  return (Array.isArray(data?.results) ? data.results : [])
    .filter((player) => !player.in_world)
    .map((player) => ({
      type: 'external-player',
      id: player.tbg_player_id,
      name: player.display_name || player.tbg_player_id,
      secondary: [player.position || 'Player', player.real_world_club || 'Outside TBG world'].filter(Boolean).join(' · '),
      transfermarkt_id: player.transfermarkt_id,
      external_player: player
    }));
}

async function search(query) {
  const ticket = ++activeRequest;
  const token = accessToken();
  if (!token) {
    renderResults([], 'Sign in again to search the TBG world.');
    return;
  }
  try {
    const headers = { authorization: `Bearer ${token}` };
    const [worldResponse, externalResponse] = await Promise.all([
      fetch(`/api/global-search?q=${encodeURIComponent(query)}`, { headers, cache: 'no-store' }),
      fetch(`/api/external-player-search?q=${encodeURIComponent(query)}&limit=12`, { headers, cache: 'no-store' }).catch(() => null)
    ]);
    const body = await worldResponse.json().catch(() => ({}));
    const externalBody = externalResponse?.ok ? await externalResponse.json().catch(() => ({})) : {};
    if (ticket !== activeRequest) return;
    if (!worldResponse.ok) throw new Error(body.error || `Search failed (HTTP ${worldResponse.status})`);
    const combined = [...(body.results || []), ...externalResults(externalBody)];
    renderResults(combined);
  } catch (error) {
    if (ticket === activeRequest) renderResults([], error.message || 'Search is temporarily unavailable.');
  }
}

async function renderShortlist() {
  try {
    const results = await shortlistResults({ force: true });
    renderResults(results, 'Your shortlist is empty. Open a player profile and choose “Add to shortlist”.');
  } catch (error) {
    renderResults([], error.message || 'Your shortlist is temporarily unavailable.');
  }
}

function install() {
  ensureStyles();
  if (searchHost()) return;
  const workspace = document.querySelector('.workspace');
  const tabs = workspace?.querySelector('.tabs');
  if (!workspace || !tabs) return;

  const host = document.createElement('div');
  host.id = 'tbgGlobalSearch';
  host.className = 'tbg-global-search';
  host.innerHTML = `<div class="global-search-heading"><label for="tbgGlobalSearchInput">Search TBG</label><button type="button" data-global-search-shortlist>★ Shortlist</button></div>
    <div class="global-search-control">
      <span aria-hidden="true">⌕</span>
      <input id="tbgGlobalSearchInput" type="search" autocomplete="off" spellcheck="false"
        placeholder="Search players and clubs…" aria-label="Search players and clubs" aria-controls="tbgGlobalSearchResults" aria-autocomplete="list" />
    </div>
    <div id="tbgGlobalSearchResults" class="global-search-results" role="listbox" data-global-search-results hidden></div>`;
  tabs.insertAdjacentElement('beforebegin', host);

  const input = host.querySelector('input');
  let timer = null;
  input.addEventListener('input', () => {
    window.clearTimeout(timer);
    const query = input.value.trim();
    if (query.length < 2) {
      activeRequest += 1;
      closeResults();
      return;
    }
    timer = window.setTimeout(() => search(query), 140);
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeResults();
      input.blur();
      return;
    }
    if (!latestResults.length) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      selectedIndex = (selectedIndex + 1) % latestResults.length;
      updateSelection();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      selectedIndex = (selectedIndex - 1 + latestResults.length) % latestResults.length;
      updateSelection();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      activate(latestResults[Math.max(0, selectedIndex)]).catch(console.error);
    }
  });
  host.addEventListener('click', (event) => {
    if (event.target.closest('[data-global-search-shortlist]')) {
      event.preventDefault();
      void renderShortlist();
      return;
    }
    const button = event.target.closest('[data-global-search-index]');
    if (!button) return;
    activate(latestResults[Number(button.dataset.globalSearchIndex)]).catch(console.error);
  });
  document.addEventListener('click', (event) => {
    if (!host.contains(event.target)) closeResults();
  });
}

install();
window.addEventListener('tbg:portal-rendered', install);
document.addEventListener('tbg:view-changed', install);
document.addEventListener('tbg:shortlist-changed', () => {
  if (!searchHost()?.querySelector('[data-global-search-results]')?.hidden && searchHost()?.querySelector('input')?.value.trim().length < 2) void renderShortlist();
});
