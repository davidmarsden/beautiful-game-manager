let directScanTimer = null;

function displayedRevision(card) {
  for (const node of card.querySelectorAll('small')) {
    const match = String(node.textContent || '').trim().match(/^Revision\s+(\d+)\b/i);
    if (match) return Number(match[1]);
  }
  return null;
}

function lockedExchangeCards() {
  return [...document.querySelectorAll('[data-first-class-deal]')].filter((card) =>
    !card.querySelector('[data-exchange-response]')
    && /multi-player exchange\s*·\s*response locked until atomic settlement is deployed/i.test(card.textContent || '')
  );
}

function unlockLockedExchangeCards() {
  for (const card of lockedExchangeCards()) {
    const dealId = String(card.dataset.firstClassDeal || '').trim();
    const revisionNo = displayedRevision(card);
    const controls = card.querySelector('.first-class-response-controls');
    if (!dealId || !revisionNo || !controls) continue;
    controls.innerHTML = `
      <small><strong>Exchange</strong> · respond to exact revision ${revisionNo}</small>
      <div class="world-control-actions transfer-exchange-response-actions">
        <button type="button" class="primary-action" data-exchange-response="accept" data-deal-id="${dealId}" data-revision-no="${revisionNo}">Accept</button>
        <button type="button" data-exchange-response="counter" data-deal-id="${dealId}" data-revision-no="${revisionNo}">Counter</button>
        <button type="button" data-exchange-response="decline" data-deal-id="${dealId}" data-revision-no="${revisionNo}">Decline</button>
      </div>`;
  }
}

function scheduleDirectScan() {
  clearTimeout(directScanTimer);
  directScanTimer = setTimeout(unlockLockedExchangeCards, 0);
}

window.addEventListener('tbg:portal-rendered', scheduleDirectScan);
document.addEventListener('tbg:view-changed', (event) => {
  if (event.detail?.view === 'transfers') scheduleDirectScan();
});
new MutationObserver((mutations) => {
  if (mutations.some((mutation) => mutation.addedNodes?.length)) scheduleDirectScan();
}).observe(document.documentElement, { childList: true, subtree: true });
scheduleDirectScan();
