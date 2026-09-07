// External-market offers are system-generated firm bids. The transfer read model now
// exposes deal_origin/external club provenance; this small presentation layer keeps the
// existing negotiations UI honest until external negotiation is deliberately designed.

function managedClubNames() {
  const select = document.getElementById('negotiationClub');
  return new Set([...select?.options || []].map((option) => option.textContent?.trim()).filter(Boolean));
}

function decorateExternalOfferCards() {
  const managedNames = managedClubNames();
  document.querySelectorAll('[data-first-class-deal]').forEach((card) => {
    const heading = card.querySelector('strong')?.textContent?.trim() || '';
    if (!heading.startsWith('Offer from ')) return;
    const counterpart = heading.slice('Offer from '.length).trim();
    if (!counterpart || managedNames.has(counterpart)) return;

    card.dataset.dealOrigin = 'external_market';
    card.querySelector('.transfer-counter-controls')?.remove();
    card.querySelectorAll('[data-agreed-change-action="propose_agreed_amendment"], [data-agreed-change-action="propose_agreed_cancellation"]')
      .forEach((control) => control.remove());

    const actionControls = card.querySelector('.first-class-response-controls');
    if (actionControls && !actionControls.querySelector('[data-external-firm-offer-note]')) {
      const note = document.createElement('small');
      note.dataset.externalFirmOfferNote = 'true';
      note.className = 'external-firm-offer-note';
      note.textContent = card.querySelector('[data-deal-response="accept_offer"]')
        ? 'External market offer · firm bid · accept or decline'
        : 'External market deal · fixed terms · awaiting completion';
      actionControls.prepend(note);
    }
  });
}

const observer = new MutationObserver(decorateExternalOfferCards);
observer.observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener('tbg:portal-rendered', () => window.setTimeout(decorateExternalOfferCards, 0));
document.addEventListener('tbg:view-changed', (event) => {
  if (event.detail?.view === 'transfers') window.setTimeout(decorateExternalOfferCards, 0);
});

decorateExternalOfferCards();
