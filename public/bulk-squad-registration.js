const nativeBulkFetch = window.fetch.bind(window);
let bulkAuthorization = '';
let bulkRoster = null;

window.fetch = async (...args) => {
  const headers = args[1]?.headers || (args[0] instanceof Request ? args[0].headers : null);
  const auth = headers instanceof Headers ? headers.get('authorization') : headers?.authorization;
  if (auth) bulkAuthorization = auth;
  return nativeBulkFetch(...args);
};

const bulkEscape = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));

async function bulkApi(body = null) {
  if (!bulkAuthorization) throw new Error('Portal session is not ready');
  const response = await nativeBulkFetch('/api/bulk-squad-registration', {
    method: body ? 'POST' : 'GET',
    headers: { authorization: bulkAuthorization, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Bulk registration request failed');
  return data;
}

function selectedIds() {
  return [...document.querySelectorAll('[data-bulk-player]:checked')].map((input) => input.value);
}

function updateBulkCount() {
  const count = selectedIds().length;
  const limit = Number(bulkRoster?.registration_limit || 25);
  const countNode = document.getElementById('bulkRegistrationCount');
  const submit = document.getElementById('submitBulkRegistration');
  if (countNode) countNode.textContent = `${count} / ${limit} selected`;
  if (submit) submit.disabled = count > limit;
}

function renderBulkRoster() {
  const list = document.getElementById('bulkRegistrationList');
  if (!list || !bulkRoster) return;
  list.innerHTML = bulkRoster.players.map((player) => `
    <label class="bulk-registration-player">
      <input type="checkbox" data-bulk-player value="${bulkEscape(player.player_id)}" ${player.registered ? 'checked' : ''}>
      <span><strong>${bulkEscape(player.display_name)}</strong><small>${bulkEscape(player.position)} · Age ${bulkEscape(player.age)} · TBG ${bulkEscape(player.rating)}</small></span>
      ${player.registered ? '<em>Registered</em>' : ''}
    </label>`).join('');
  list.querySelectorAll('[data-bulk-player]').forEach((input) => input.addEventListener('change', updateBulkCount));
  updateBulkCount();
}

function mountBulkRegistration() {
  if (document.getElementById('bulkRegistrationCard')) return;
  const singleSelect = document.getElementById('registrationPlayer');
  const card = singleSelect?.closest('.world-control-card');
  if (!card) return;
  card.id = 'bulkRegistrationCard';
  card.innerHTML = `
    <select id="registrationPlayer" hidden aria-hidden="true" tabindex="-1"></select>
    <div class="world-control-heading">
      <div><h3>Senior squad registration</h3><p>Select the complete senior squad for the next checkpoint. Players aged 21 or younger are youth-eligible and do not appear here.</p></div>
      <strong id="bulkRegistrationCount">Loading…</strong>
    </div>
    <div class="bulk-registration-actions">
      <button id="selectBestBulkRegistration" type="button">Select best available</button>
      <button id="restoreBulkRegistration" type="button">Restore current</button>
    </div>
    <div id="bulkRegistrationList" class="bulk-registration-list"><p>Loading senior squad…</p></div>
    <button id="submitBulkRegistration" class="primary-action" type="button">Submit senior squad registration</button>
    <p id="bulkRegistrationMessage" class="world-control-message" aria-live="polite"></p>`;

  document.getElementById('selectBestBulkRegistration').addEventListener('click', () => {
    const limit = Number(bulkRoster?.registration_limit || 25);
    const best = new Set((bulkRoster?.players || []).slice(0, limit).map((player) => player.player_id));
    document.querySelectorAll('[data-bulk-player]').forEach((input) => { input.checked = best.has(input.value); });
    updateBulkCount();
  });
  document.getElementById('restoreBulkRegistration').addEventListener('click', () => {
    const current = new Set((bulkRoster?.players || []).filter((player) => player.registered).map((player) => player.player_id));
    document.querySelectorAll('[data-bulk-player]').forEach((input) => { input.checked = current.has(input.value); });
    updateBulkCount();
  });
  document.getElementById('submitBulkRegistration').addEventListener('click', submitBulkRegistration);
}

async function loadBulkRegistration() {
  mountBulkRegistration();
  const message = document.getElementById('bulkRegistrationMessage');
  try {
    bulkRoster = await bulkApi();
    renderBulkRoster();
    if (message) message.textContent = `${bulkRoster.selected_count} senior players currently registered.`;
  } catch (error) {
    if (message) message.textContent = error.message;
  }
}

async function submitBulkRegistration() {
  const button = document.getElementById('submitBulkRegistration');
  const message = document.getElementById('bulkRegistrationMessage');
  const playerIds = selectedIds();
  const limit = Number(bulkRoster?.registration_limit || 25);
  if (playerIds.length > limit) {
    message.textContent = `Select no more than ${limit} senior players.`;
    return;
  }
  button.disabled = true;
  message.textContent = 'Submitting senior squad registration…';
  try {
    const batchId = window.crypto?.randomUUID ? window.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const result = await bulkApi({ player_ids: playerIds, batch_id: batchId });
    message.textContent = result.command_count
      ? `${result.command_count} registration changes queued for the next shared-world checkpoint.`
      : 'This senior squad is already the current registration.';
    bulkRoster = await bulkApi();
    renderBulkRoster();
    window.dispatchEvent(new CustomEvent('tbg:world-submission', { detail: result }));
  } catch (error) {
    message.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

window.addEventListener('tbg:portal-rendered', () => {
  window.setTimeout(loadBulkRegistration, 0);
});