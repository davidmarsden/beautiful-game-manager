let directScanTimer = null;
let counterReadyObserver = null;

function displayedRevision(card) {
  for (const node of card.querySelectorAll('small')) {
    const match = String(node.textContent || '').trim().match(/^Revision\s+(\d+)\b/i);
    if (match) return Number(match[1]);
  }
  return null;
}

function ownClubName() {
  return String(document.getElementById('clubName')?.textContent || '').trim();
}

function counterpartName(card) {
  const label = String(card.querySelector('strong')?.textContent || '').trim();
  return label.replace(/^Offer\s+(?:from|to)\s+/i, '').trim();
}

function ensureBothDealSides(card) {
  const summaries = [...card.querySelectorAll('.transfer-exchange-summary-side')];
  if (!summaries.length) return;
  const names = new Set(summaries.map((side) => String(side.querySelector('strong')?.textContent || '').replace(/\s+gives$/i, '').trim()).filter(Boolean));
  const own = ownClubName();
  const other = counterpartName(card);
  const summaryHost = summaries[0]?.parentElement;
  if (!summaryHost) return;
  for (const name of [own, other]) {
    if (!name || names.has(name)) continue;
    const side = document.createElement('div');
    side.className = 'transfer-exchange-summary-side';
    side.dataset.emptyDealSide = 'true';
    side.innerHTML = `<strong>${name} gives</strong><small>Nothing</small>`;
    summaryHost.append(side);
    names.add(name);
  }
}

function lockedExchangeCards() {
  return [...document.querySelectorAll('[data-first-class-deal]')].filter((card) =>
    !card.querySelector('[data-exchange-response]')
    && /multi-player exchange\s*·\s*response locked until atomic settlement is deployed/i.test(card.textContent || '')
  );
}

function unlockLockedExchangeCards() {
  for (const card of document.querySelectorAll('[data-first-class-deal]')) ensureBothDealSides(card);
  for (const card of lockedExchangeCards()) {
    const dealId = String(card.dataset.firstClassDeal || '').trim();
    const revisionNo = displayedRevision(card);
    const controls = card.querySelector('.first-class-response-controls');
    if (!dealId || !revisionNo || !controls) continue;
    controls.innerHTML = `
      <small><strong>Deal</strong> · respond to exact revision ${revisionNo}</small>
      <div class="world-control-actions transfer-exchange-response-actions">
        <button type="button" class="primary-action" data-exchange-response="accept" data-deal-id="${dealId}" data-revision-no="${revisionNo}">Accept</button>
        <button type="button" data-exchange-response="counter" data-deal-id="${dealId}" data-revision-no="${revisionNo}">Counter</button>
        <button type="button" data-exchange-response="decline" data-deal-id="${dealId}" data-revision-no="${revisionNo}">Decline</button>
      </div>`;
  }
}

function showCounterLoading(button) {
  const revisionNo = Number(button.dataset.revisionNo || 0);
  button.dataset.originalText = button.dataset.originalText || button.textContent;
  button.textContent = 'Loading counter…';
  button.setAttribute('aria-busy', 'true');
  const message = document.getElementById('transferNegotiationMessage');
  if (message) message.textContent = revisionNo
    ? `Loading Revision ${revisionNo} into the counter-offer editor…`
    : 'Loading counter-offer editor…';
  document.querySelector('.transfer-negotiation-compose')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  watchForCounterEditor(button, revisionNo);
}

function watchForCounterEditor(button, revisionNo) {
  counterReadyObserver?.disconnect();
  const finish = () => {
    const submit = document.getElementById('submitNegotiation');
    if (submit?.textContent?.trim() !== 'Send counter-offer') return false;
    counterReadyObserver?.disconnect();
    counterReadyObserver = null;
    button.textContent = button.dataset.originalText || 'Counter';
    button.removeAttribute('aria-busy');
    const composer = document.querySelector('.transfer-negotiation-compose');
    const heading = composer?.querySelector('h3');
    const club = document.getElementById('negotiationClub');
    const other = String(club?.selectedOptions?.[0]?.textContent || '').trim();
    if (heading) heading.textContent = other ? `Counter-offer to ${other}` : 'Counter-offer';
    let banner = document.getElementById('exchangeCounterEditorBanner');
    if (!banner && composer && heading) {
      banner = document.createElement('p');
      banner.id = 'exchangeCounterEditorBanner';
      banner.className = 'world-control-status';
      heading.after(banner);
    }
    if (banner) banner.textContent = revisionNo
      ? `Editing Revision ${revisionNo} · change any players, contracts or cash below`
      : 'Editing counter-offer · change any players, contracts or cash below';
    composer?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    banner?.focus?.({ preventScroll: true });
    return true;
  };
  if (finish()) return;
  counterReadyObserver = new MutationObserver(() => finish());
  counterReadyObserver.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  setTimeout(() => {
    if (!counterReadyObserver) return;
    counterReadyObserver.disconnect();
    counterReadyObserver = null;
    button.textContent = button.dataset.originalText || 'Counter';
    button.removeAttribute('aria-busy');
  }, 10_000);
}

function scheduleDirectScan() {
  clearTimeout(directScanTimer);
  directScanTimer = setTimeout(unlockLockedExchangeCards, 0);
}

document.addEventListener('pointerdown', (event) => {
  const button = event.target.closest('[data-exchange-response="counter"]');
  if (button) showCounterLoading(button);
}, true);

window.addEventListener('tbg:portal-rendered', scheduleDirectScan);
document.addEventListener('tbg:view-changed', (event) => {
  if (event.detail?.view === 'transfers') scheduleDirectScan();
});
new MutationObserver((mutations) => {
  if (mutations.some((mutation) => mutation.addedNodes?.length)) scheduleDirectScan();
}).observe(document.documentElement, { childList: true, subtree: true });
scheduleDirectScan();
