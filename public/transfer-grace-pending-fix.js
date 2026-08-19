function restorePendingGraceCancellation(root = document) {
  root.querySelectorAll?.('.incoming-transfer-offer[data-first-class-deal]').forEach((card) => {
    const controls = card.querySelector('.first-class-response-controls');
    const status = controls?.querySelector('.world-control-status');
    if (!controls || !status || !status.textContent.includes('Deal agreed · mistake grace')) return;
    if (controls.querySelector('[data-agreed-change-action="cancel_in_grace"]')) return;

    const dealId = card.dataset.firstClassDeal;
    if (!dealId) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'primary-action';
    button.dataset.agreedChangeAction = 'cancel_in_grace';
    button.dataset.dealId = dealId;
    button.textContent = 'Cancel during mistake grace';
    controls.append(button);
  });
}

restorePendingGraceCancellation();

const observer = new MutationObserver((records) => {
  for (const record of records) {
    for (const node of record.addedNodes) {
      if (node.nodeType === Node.ELEMENT_NODE) restorePendingGraceCancellation(node);
    }
  }
});

observer.observe(document.documentElement, { childList: true, subtree: true });
