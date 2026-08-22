let directScanTimer = null;
let counterReadyObserver = null;
let activeCounterButton = null;

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

function appendEmptyDealSide(summaryHost, name) {
  const side = document.createElement('div');
  side.className = 'transfer-exchange-summary-side';
  side.dataset.emptyDealSide = 'true';
  const heading = document.createElement('strong');
  heading.textContent = `${name} gives`;
  const nothing = document.createElement('small');
  nothing.textContent = 'Nothing';
  side.append(heading, nothing);
  summaryHost.append(side);
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
    appendEmptyDealSide(summaryHost, name);
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

function resetCounterLoading(button) {
  if (!button) return;
  button.textContent = button.dataset.originalText || 'Counter';
  button.removeAttribute('aria-busy');
}

function counterEditorReady({ revisionNo, expectedCounterpart }) {
  const submit = document.getElementById('submitNegotiation');
  const message = String(document.getElementById('transferNegotiationMessage')?.textContent || '').trim();
  const club = document.getElementById('negotiationClub');
  const selectedCounterpart = String(club?.selectedOptions?.[0]?.textContent || '').trim();
  return submit?.textContent?.trim() === 'Send counter-offer'
    && message.startsWith(`Editing counter-offer to revision ${revisionNo}.`)
    && (!expectedCounterpart || selectedCounterpart === expectedCounterpart);
}

function finalizeCounterEditor(button, revisionNo, expectedCounterpart) {
  if (!counterEditorReady({ revisionNo, expectedCounterpart })) return false;
  counterReadyObserver?.disconnect();
  counterReadyObserver = null;
  activeCounterButton = null;
  resetCounterLoading(button);
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
    banner.tabIndex = -1;
    heading.after(banner);
  }
  if (banner) banner.textContent = `Editing Revision ${revisionNo} · change any players, contracts or cash below`;
  composer?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  banner?.focus?.({ preventScroll: true });
  return true;
}

function watchForCounterEditor(button, revisionNo, expectedCounterpart) {
  counterReadyObserver?.disconnect();
  counterReadyObserver = new MutationObserver(() => finalizeCounterEditor(button, revisionNo, expectedCounterpart));
  counterReadyObserver.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  setTimeout(() => {
    if (activeCounterButton !== button) return;
    counterReadyObserver?.disconnect();
    counterReadyObserver = null;
    activeCounterButton = null;
    resetCounterLoading(button);
  }, 10_000);
}

function showCounterLoading(button) {
  const revisionNo = Number(button.dataset.revisionNo || 0);
  const card = button.closest('[data-first-class-deal]');
  const expectedCounterpart = counterpartName(card);
  if (activeCounterButton && activeCounterButton !== button) resetCounterLoading(activeCounterButton);
  activeCounterButton = button;
  button.dataset.originalText = button.dataset.originalText || button.textContent;
  button.textContent = 'Loading counter…';
  button.setAttribute('aria-busy', 'true');
  const message = document.getElementById('transferNegotiationMessage');
  if (message) message.textContent = revisionNo
    ? `Loading Revision ${revisionNo} into the counter-offer editor…`
    : 'Loading counter-offer editor…';
  document.querySelector('.transfer-negotiation-compose')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  watchForCounterEditor(button, revisionNo, expectedCounterpart);
}

function scheduleDirectScan() {
  clearTimeout(directScanTimer);
  directScanTimer = setTimeout(unlockLockedExchangeCards, 0);
}

document.addEventListener('click', (event) => {
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
