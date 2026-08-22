let reviewTimer = null;

const $ = (id) => document.getElementById(id);

function parseMoney(value) {
  return Math.max(0, Number(String(value ?? '').replace(/[^0-9.-]/g, '')) || 0);
}

function formatMoney(value) {
  return `£${Number(value || 0).toLocaleString('en-GB')}`;
}

function ensurePickerPlaceholder(select, label) {
  if (!select || select.options?.[0]?.value === '') return;
  const option = document.createElement('option');
  option.value = '';
  option.textContent = label;
  select.prepend(option);
  select.value = '';
}

function ensurePickerHelp(select) {
  const label = select?.closest('label');
  if (!label || label.querySelector('[data-add-player-help]')) return;
  const help = document.createElement('small');
  help.dataset.addPlayerHelp = 'true';
  help.textContent = 'Choosing a player here does not add them to the deal. Press Add player.';
  label.append(help);
}

function playerLines(containerId) {
  const container = $(containerId);
  if (!container) return [];
  return [...container.querySelectorAll('.transfer-exchange-selected-player')].map((row) => {
    const name = String(row.querySelector('strong')?.textContent || '').trim();
    const contract = String(row.querySelector('select')?.selectedOptions?.[0]?.textContent || '').trim();
    return [name, contract ? `${contract} contract` : ''].filter(Boolean).join(' · ');
  }).filter(Boolean);
}

function currentDealSides() {
  const receive = playerLines('receivePlayersSelected');
  const offer = playerLines('offerPlayersSelected');
  const receiveCash = parseMoney($('receiveCash')?.value);
  const offerCash = parseMoney($('offerCash')?.value);
  if (receiveCash > 0) receive.push(formatMoney(receiveCash));
  if (offerCash > 0) offer.push(formatMoney(offerCash));
  return { receive, offer };
}

function appendSide(panel, headingText, entries) {
  const side = document.createElement('div');
  side.className = 'transfer-deal-review-side';
  const heading = document.createElement('strong');
  heading.textContent = headingText;
  side.append(heading);
  const list = document.createElement('ul');
  const values = entries.length ? entries : ['Nothing'];
  for (const value of values) {
    const item = document.createElement('li');
    item.textContent = value;
    list.append(item);
  }
  side.append(list);
  panel.append(side);
}

function ensureReviewPanel() {
  const submit = $('submitNegotiation');
  const composer = submit?.closest('.transfer-negotiation-compose');
  if (!submit || !composer) return null;
  let panel = $('transferDealReview');
  if (!panel) {
    panel = document.createElement('section');
    panel.id = 'transferDealReview';
    panel.className = 'transfer-deal-review';
    panel.setAttribute('aria-live', 'polite');
    submit.before(panel);
  }
  return panel;
}

function renderReview() {
  const action = $('negotiationAction')?.value;
  const panel = ensureReviewPanel();
  if (!panel) return;
  if (action === 'listing') {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;

  ensurePickerPlaceholder($('receivePlayer'), 'Choose a player to add…');
  ensurePickerPlaceholder($('offerPlayer'), 'Choose a player to add…');
  ensurePickerHelp($('receivePlayer'));
  ensurePickerHelp($('offerPlayer'));

  const { receive, offer } = currentDealSides();
  panel.replaceChildren();

  const heading = document.createElement('h4');
  heading.textContent = 'Review this deal before sending';
  panel.append(heading);
  appendSide(panel, 'You receive', receive);
  appendSide(panel, 'You give', offer);

  const hasAnything = receive.length > 0 || offer.length > 0;
  const oneSided = hasAnything && (receive.length === 0 || offer.length === 0);
  panel.dataset.oneSided = oneSided ? 'true' : 'false';

  if (oneSided) {
    const warning = document.createElement('div');
    warning.className = 'transfer-deal-one-sided-warning';
    const text = document.createElement('strong');
    text.textContent = receive.length === 0
      ? 'Warning: you receive nothing in this deal.'
      : 'Warning: the other club gives nothing in this deal.';
    warning.append(text);

    const label = document.createElement('label');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = 'confirmOneSidedDeal';
    label.append(checkbox, document.createTextNode(' I understand this is a one-sided deal and still want to send it.'));
    warning.append(label);
    panel.append(warning);
  }
}

function guardSubmission(event) {
  const submit = event.target.closest('#submitNegotiation');
  if (!submit || $('negotiationAction')?.value === 'listing') return;
  renderReview();
  const panel = $('transferDealReview');
  if (panel?.dataset.oneSided !== 'true') return;
  const confirmed = $('confirmOneSidedDeal')?.checked;
  if (confirmed) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const message = $('transferNegotiationMessage');
  if (message) message.textContent = 'This deal is one-sided. Review the summary and confirm that you intend to send it.';
  panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function suppressLegacyComplexAmendments() {
  for (const card of document.querySelectorAll('[data-first-class-deal]')) {
    const sides = card.querySelectorAll('.transfer-exchange-summary-side');
    const playerRows = [...sides].flatMap((side) => [...side.querySelectorAll('small')])
      .filter((node) => !/^£/.test(String(node.textContent || '').trim()));
    if (playerRows.length <= 1) continue;
    const controls = card.querySelector('.first-class-response-controls');
    const amendment = controls?.querySelector('.transfer-counter-controls');
    if (!amendment || amendment.dataset.complexDealSuppressed === 'true') continue;
    amendment.dataset.complexDealSuppressed = 'true';
    amendment.hidden = true;
    const note = document.createElement('small');
    note.className = 'transfer-complex-amendment-note';
    note.textContent = 'This is a multi-player deal. The single-fee/contract amendment form does not represent all deal legs, so it is disabled. Use mistake-grace cancellation or mutual cancellation if the agreed terms need to be undone.';
    amendment.before(note);
  }
}

function refreshHardening() {
  renderReview();
  suppressLegacyComplexAmendments();
}

function scheduleRefresh() {
  clearTimeout(reviewTimer);
  reviewTimer = setTimeout(refreshHardening, 0);
}

document.addEventListener('click', guardSubmission, true);
document.addEventListener('click', (event) => {
  if (event.target.closest('#addReceivePlayer, #addOfferPlayer, [data-remove-exchange-player]')) setTimeout(scheduleRefresh, 0);
});
document.addEventListener('change', (event) => {
  if (event.target.closest('#negotiationAction, #negotiationClub, #receiveCash, #offerCash, [data-exchange-contract-player]')) scheduleRefresh();
});
document.addEventListener('input', (event) => {
  if (event.target.closest('#receiveCash, #offerCash')) scheduleRefresh();
});
window.addEventListener('tbg:portal-rendered', scheduleRefresh);
document.addEventListener('tbg:view-changed', (event) => {
  if (event.detail?.view === 'transfers') scheduleRefresh();
});
new MutationObserver((mutations) => {
  if (mutations.some((mutation) => mutation.addedNodes?.length || mutation.removedNodes?.length)) scheduleRefresh();
}).observe(document.documentElement, { childList: true, subtree: true });
scheduleRefresh();
