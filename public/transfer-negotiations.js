const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));

let authorization = '';
let state = null;
let mounted = false;
const nativeFetch = window.fetch.bind(window);
window.fetch = async (...args) => {
  const headers = args[1]?.headers || (args[0] instanceof Request ? args[0].headers : null);
  const auth = headers instanceof Headers ? headers.get('authorization') : headers?.authorization;
  if (auth) authorization = auth;
  return nativeFetch(...args);
};

const $ = (id) => document.getElementById(id);

async function request(path, body = null) {
  if (!authorization) throw new Error('Portal session is not ready');
  const response = await nativeFetch(path, {
    method: body ? 'POST' : 'GET',
    headers: { authorization, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Transfer request failed');
  return data;
}

function mount() {
  if (mounted || !$('worldView')) return;
  mounted = true;
  const legacy = document.querySelector('.world-transfer-card');
  if (legacy) legacy.hidden = true;
  $('worldControls')?.insertAdjacentHTML('afterend', `
    <section id="transferNegotiationWorkspace" class="world-control-card transfer-negotiation-workspace">
      <div class="world-control-heading"><div><h3>Transfer negotiations</h3><p>Make offers to other managed clubs and answer proposals addressed to your club. Accepted deals are applied at the next canonical checkpoint.</p></div><span id="transferNegotiationStatus" class="world-control-status">Loading…</span></div>
      <div class="transfer-negotiation-grid">
        <article class="transfer-negotiation-compose">
          <h4>New proposal</h4>
          <label>Action<select id="negotiationAction"><option value="offer">Make an offer</option><option value="listing">List an owned player</option></select></label>
          <label id="negotiationClubLabel">Selling club<select id="negotiationClub"></select></label>
          <label>Player<select id="negotiationPlayer"></select></label>
          <label>Fee<input id="negotiationFee" type="number" min="0" step="1" value="0"></label>
          <label id="negotiationContractLabel">Proposed contract<select id="negotiationContractYears"><option value="1">1 season</option><option value="2">2 seasons</option><option value="3" selected>3 seasons</option><option value="4">4 seasons</option><option value="5">5 seasons</option></select></label>
          <button id="submitNegotiation" class="primary-action" type="button">Submit transfer offer</button>
        </article>
        <article>
          <h4>Incoming offers</h4>
          <div id="incomingTransferOffers"></div>
        </article>
      </div>
      <p id="transferNegotiationMessage" class="world-control-message" aria-live="polite"></p>
    </section>`);
  $('negotiationAction').addEventListener('change', renderComposer);
  $('negotiationClub').addEventListener('change', renderPlayerOptions);
  $('submitNegotiation').addEventListener('click', submitProposal);
  $('incomingTransferOffers').addEventListener('click', (event) => {
    const button = event.target.closest('[data-transfer-response]');
    if (button) respond(button.dataset.proposalId, button.dataset.transferResponse);
  });
}

function clubs() { return state?.directory?.clubs || []; }
function players() { return state?.directory?.players || []; }

function renderComposer() {
  const action = $('negotiationAction').value;
  const ownClub = state?.club_id;
  const clubLabel = $('negotiationClubLabel');
  const contractLabel = $('negotiationContractLabel');
  clubLabel.hidden = action === 'listing';
  contractLabel.hidden = action === 'listing';
  const managedCounterparts = clubs().filter((club) => club.club_id !== ownClub && club.managed);
  $('negotiationClub').innerHTML = managedCounterparts
    .map((club) => `<option value="${escapeHtml(club.club_id)}">${escapeHtml(club.club_name)}</option>`).join('');
  $('submitNegotiation').textContent = action === 'listing' ? 'List player for transfer' : 'Submit transfer offer';
  if (action === 'offer' && !managedCounterparts.length) {
    $('negotiationPlayer').innerHTML = '<option value="">No other managed clubs available</option>';
    $('submitNegotiation').disabled = true;
    return;
  }
  renderPlayerOptions();
}

function renderPlayerOptions() {
  const action = $('negotiationAction').value;
  const clubId = action === 'listing' ? state?.club_id : $('negotiationClub').value;
  const options = players().filter((player) => player.club_id === clubId)
    .map((player) => `<option value="${escapeHtml(player.player_id)}">${escapeHtml(player.player_name)} · ${escapeHtml(player.position)}${player.rating ? ` · ${escapeHtml(player.rating)}` : ''}</option>`).join('');
  $('negotiationPlayer').innerHTML = options || '<option value="">No players available</option>';
  $('submitNegotiation').disabled = !options || state?.turn_status !== 'open';
}

function renderIncoming() {
  const offers = state?.incoming_offers || [];
  $('incomingTransferOffers').innerHTML = offers.length ? offers.map((offer) => `
    <article class="incoming-transfer-offer">
      <div><strong>${escapeHtml(offer.player_name)}</strong><span>${escapeHtml(offer.buyer_club_name)} offer £${Number(offer.fee || 0).toLocaleString('en-GB')}</span><small>${escapeHtml(offer.contract_years)}-season contract · submitted ${escapeHtml(new Date(offer.submitted_at).toLocaleString('en-GB'))}</small></div>
      <div class="world-control-actions">
        <button type="button" class="primary-action" data-transfer-response="accepted" data-proposal-id="${escapeHtml(offer.proposal_id)}">Accept</button>
        <button type="button" data-transfer-response="declined" data-proposal-id="${escapeHtml(offer.proposal_id)}">Decline</button>
      </div>
    </article>`).join('') : '<p>No transfer offers are awaiting your response.</p>';
}

function render() {
  if (!state) return;
  $('transferNegotiationStatus').textContent = state.turn_status === 'open' ? `${state.incoming_offers.length} awaiting response` : `World ${state.turn_status}`;
  renderComposer();
  renderIncoming();
}

async function refresh() {
  state = await request('/api/transfer-negotiations');
  render();
}

async function submitProposal() {
  const message = $('transferNegotiationMessage');
  const action = $('negotiationAction').value;
  const playerId = $('negotiationPlayer').value;
  if (!playerId) return;
  message.textContent = action === 'listing' ? 'Submitting transfer listing…' : 'Submitting transfer offer…';
  $('submitNegotiation').disabled = true;
  try {
    const payload = action === 'listing'
      ? { direction: 'sell', playerId, fee: Number($('negotiationFee').value) || 0 }
      : {
          direction: 'buy',
          playerId,
          otherClubId: $('negotiationClub').value,
          fee: Number($('negotiationFee').value) || 0,
          contractYears: Number($('negotiationContractYears').value) || 3
        };
    await request('/api/shared-world', { type: 'submit_command', command_type: action === 'listing' ? 'transfer_listing' : 'transfer_offer', command_payload: payload });
    message.textContent = action === 'listing' ? 'Player listed. The request is recorded in your command history.' : 'Offer submitted to the other manager.';
    await refresh();
  } catch (error) {
    message.textContent = error.message;
  } finally {
    renderPlayerOptions();
  }
}

async function respond(proposalId, response) {
  const message = $('transferNegotiationMessage');
  message.textContent = `${response === 'accepted' ? 'Accepting' : 'Declining'} transfer offer…`;
  document.querySelectorAll('[data-transfer-response]').forEach((button) => { button.disabled = true; });
  try {
    await request('/api/transfer-negotiations', { proposal_id: proposalId, response });
    message.textContent = response === 'accepted'
      ? 'Offer accepted. The transfer will be validated and applied at the next canonical checkpoint.'
      : 'Offer declined. Both clubs will receive the recorded outcome.';
    await refresh();
  } catch (error) {
    message.textContent = error.message;
  }
}

window.addEventListener('tbg:portal-rendered', async () => {
  mount();
  try { await refresh(); }
  catch (error) {
    if ($('transferNegotiationStatus')) $('transferNegotiationStatus').textContent = 'Unavailable';
    if ($('transferNegotiationMessage')) $('transferNegotiationMessage').textContent = error.message;
  }
});
