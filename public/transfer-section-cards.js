const SECTION_STYLE_ID = 'tbgTransferSectionCardStyles';
const SECTION_NAV_ID = 'transferSectionCards';
const DEFAULT_SECTION = 'my';

const SECTIONS = [
  ['my', 'My Transfers', 'Proposals, offers and your listings'],
  ['market', 'Transfer Market', 'Listed players, free agents and external search'],
  ['world', 'World Transfers', 'Accepted deals across the managed world'],
  ['history', 'History', 'Your completed and closed transfer record']
];

let activeSection = DEFAULT_SECTION;
let workspaceObserver = null;
let observedWorkspace = null;

function ensureStyles() {
  if (document.getElementById(SECTION_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = SECTION_STYLE_ID;
  style.textContent = `
    .transfer-section-cards {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: .7rem;
      margin: .2rem 0 1rem;
    }
    .transfer-section-card {
      appearance: none;
      width: 100%;
      min-height: 86px;
      padding: .85rem .9rem;
      border: 1px solid var(--border, rgba(127,127,127,.3));
      border-radius: 12px;
      background: var(--panel, #fff);
      color: inherit;
      text-align: left;
      cursor: pointer;
      box-shadow: none;
    }
    .transfer-section-card strong,
    .transfer-section-card small { display: block; }
    .transfer-section-card strong { margin-bottom: .25rem; }
    .transfer-section-card small { opacity: .76; line-height: 1.3; }
    .transfer-section-card[aria-pressed="true"] {
      font-weight: 700;
      box-shadow: inset 0 -3px currentColor;
      border-color: currentColor;
    }
    .transfer-section-hidden { display: none !important; }
    .transfer-negotiation-grid.transfer-section-single {
      display: block;
    }
    .transfer-negotiation-grid.transfer-section-single > article:not(.transfer-section-hidden) {
      width: 100%;
      max-width: none;
    }
    @media (max-width: 820px) {
      .transfer-section-cards { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    @media (max-width: 480px) {
      .transfer-section-cards { grid-template-columns: 1fr; gap: .5rem; }
      .transfer-section-card { min-height: 0; }
    }
  `;
  document.head.append(style);
}

function workspace() {
  return document.getElementById('transferNegotiationWorkspace');
}

function grid() {
  return workspace()?.querySelector('.transfer-negotiation-grid') || null;
}

function ensureNavigation() {
  const root = workspace();
  const heading = root?.querySelector('.world-control-heading');
  if (!root || !heading) return null;
  let nav = document.getElementById(SECTION_NAV_ID);
  if (!nav) {
    nav = document.createElement('nav');
    nav.id = SECTION_NAV_ID;
    nav.className = 'transfer-section-cards';
    nav.setAttribute('aria-label', 'Transfer sections');
    nav.innerHTML = SECTIONS.map(([key, title, detail]) => `
      <button type="button" class="transfer-section-card" data-transfer-section="${key}" aria-pressed="${key === DEFAULT_SECTION}">
        <strong>${title}</strong><small>${detail}</small>
      </button>`).join('');
    heading.after(nav);
  }
  return nav;
}

function setHidden(node, hidden) {
  node?.classList.toggle('transfer-section-hidden', Boolean(hidden));
  if (node) node.setAttribute('aria-hidden', String(Boolean(hidden)));
}

function applyVisibility() {
  const root = workspace();
  const transferGrid = grid();
  if (!root || !transferGrid) return false;

  ensureStyles();
  const nav = ensureNavigation();
  nav?.querySelectorAll('[data-transfer-section]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.transferSection === activeSection));
  });

  const market = document.getElementById('openMarketWorkspace');
  const world = document.getElementById('worldTransferRegisterPanel');
  const history = document.getElementById('firstClassTransferHistoryPanel');
  const legacy = root.querySelector('.transfer-legacy-note');
  const primaryItems = Array.from(transferGrid.children).filter((child) => child !== world && child !== history);

  setHidden(market, activeSection !== 'market');
  setHidden(world, activeSection !== 'world');
  setHidden(history, activeSection !== 'history');
  setHidden(legacy, activeSection !== 'history');
  primaryItems.forEach((item) => setHidden(item, activeSection !== 'my'));

  const gridNeeded = activeSection !== 'market';
  setHidden(transferGrid, !gridNeeded);
  transferGrid.classList.toggle('transfer-section-single', activeSection === 'world' || activeSection === 'history');

  // The canonical feedback message stays available to the action-local feedback
  // helper, but is only visually relevant while the manager is doing their own deals.
  const message = document.getElementById('transferNegotiationMessage');
  setHidden(message, activeSection !== 'my');
  return true;
}

function selectSection(section, { focus = false } = {}) {
  if (!SECTIONS.some(([key]) => key === section)) return false;
  activeSection = section;
  if (!applyVisibility()) return false;
  if (focus) document.querySelector(`[data-transfer-section="${section}"]`)?.focus();
  document.dispatchEvent(new CustomEvent('tbg:transfer-section-changed', { detail: { section } }));
  return true;
}

function observeWorkspace() {
  const root = workspace();
  if (!root || observedWorkspace === root) return;
  workspaceObserver?.disconnect();
  observedWorkspace = root;
  workspaceObserver = new MutationObserver(() => applyVisibility());
  workspaceObserver.observe(root, { childList: true, subtree: true });
}

function mount() {
  if (!workspace()) return false;
  ensureStyles();
  ensureNavigation();
  observeWorkspace();
  return applyVisibility();
}

function scheduleMount() {
  queueMicrotask(() => {
    if (mount()) return;
    setTimeout(mount, 0);
  });
}

document.addEventListener('click', (event) => {
  const sectionButton = event.target.closest?.('[data-transfer-section]');
  if (sectionButton) {
    event.preventDefault();
    selectSection(sectionButton.dataset.transferSection);
    return;
  }

  // Open Market's existing Prepare offer action fills the first-class composer.
  // Move the manager to that composer after the market handler has populated it.
  if (event.target.closest?.('[data-open-market-prepare-offer]')) {
    queueMicrotask(() => selectSection('my'));
  }
});

document.addEventListener('tbg:view-changed', (event) => {
  if (event.detail?.view !== 'transfers') return;
  // Opening Transfers always returns to the action-first landing card.
  activeSection = DEFAULT_SECTION;
  scheduleMount();
});
window.addEventListener('tbg:portal-rendered', scheduleMount);
document.addEventListener('tbg:transfer-history-refresh', scheduleMount);

scheduleMount();

export { selectSection };
