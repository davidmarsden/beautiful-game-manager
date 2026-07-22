const $ = (id) => document.getElementById(id);
const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));

let authorization = '';
let bootstrap = null;
let controlState = null;

const nativeFetch = window.fetch.bind(window);
window.fetch = async (...args) => {
  const headers = args[1]?.headers || (args[0] instanceof Request ? args[0].headers : null);
  const auth = headers instanceof Headers ? headers.get('authorization') : headers?.authorization;
  if (auth) authorization = auth;
  return nativeFetch(...args);
};

function mount() {
  const workspace = document.querySelector('.workspace');
  const tabs = workspace?.querySelector('.tabs');
  if (!workspace || !tabs || $('worldView')) return;
  tabs.insertAdjacentHTML('beforeend', '<button data-view="world">World Control</button>');
  workspace.insertAdjacentHTML('beforeend', `
    <div id="worldView" class="view">
      <div class="world-control-heading">
        <div><h2>Persistent World Control</h2><p>Save, resume and advance the world from this manager portal.</p></div>
        <span id="worldControlStatus" class="world-control-status">Checking save…</span>
      </div>
      <section id="worldControlSummary" class="world-control-summary"></section>
      <section class="world-control-grid">
        <article class="world-control-card">
          <h3>Save and resume</h3>
          <p>The canonical save is stored against your manager and world appointment.</p>
          <div class="world-control-actions">
            <button id="refreshWorldSave" type="button">Load latest</button>
            <button id="exportWorldSave" type="button">Export save</button>
            <label class="file-action">Import save<input id="importWorldSave" type="file" accept="application/json,.json"></label>
          </div>
        </article>
        <article class="world-control-card">
          <h3>Advance world</h3>
          <p>Processes exactly one matchday across all five divisions and creates a new checkpoint.</p>
          <button id="advanceWorld" class="primary-action" type="button">Advance one matchday</button>
        </article>
        <article class="world-control-card">
          <h3>Registration</h3>
          <label>Owned player<select id="registrationPlayer"></select></label>
          <div class="world-control-actions"><button id="registerWorldPlayer" type="button">Register</button><button id="unregisterWorldPlayer" type="button">Unregister</button></div>
        </article>
        <article class="world-control-card">
          <h3>Contracts</h3>
          <label>Owned player<select id="contractPlayer"></select></label>
          <label>Extension<select id="contractYears"><option value="1">1 season</option><option value="2" selected>2 seasons</option><option value="3">3 seasons</option><option value="4">4 seasons</option><option value="5">5 seasons</option></select></label>
          <button id="renewWorldContract" type="button">Offer renewal</button>
        </article>
        <article class="world-control-card world-transfer-card">
          <h3>Transfers</h3>
          <label>Direction<select id="transferDirection"><option value="sell">Sell owned player</option><option value="buy">Buy player</option></select></label>
          <label>Player ID<input id="transferPlayerId" autocomplete="off" placeholder="tbg-player-id"></label>
          <label>Other club ID<input id="transferClubId" autocomplete="off" placeholder="tbg-club-id"></label>
          <label>Fee<input id="transferFee" type="number" min="0" step="1" value="0"></label>
          <button id="submitWorldTransfer" type="button">Complete transfer</button>
        </article>
      </section>
      <p id="worldControlMessage" class="world-control-message" aria-live="polite"></p>
    </div>`);

  document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => {
    document.querySelectorAll('.view').forEach((view) => view.classList.toggle('active', view.id === `${button.dataset.view}View`));
    document.querySelectorAll('[data-view]').forEach((tab) => tab.classList.toggle('active', tab.dataset.view === button.dataset.view));
  }));
  bind();
}

function options() {
  const squad = bootstrap?.squad || [];
  return squad.map((player) => `<option value="${escapeHtml(player.tbg_player_id)}">${escapeHtml(player.display_name || player.tbg_player_id)}</option>`).join('');
}

function render() {
  const summary = controlState?.summary;
  $('worldControlStatus').textContent = controlState?.has_save ? 'Save ready' : 'No save imported';
  $('worldControlSummary').innerHTML = summary ? `
    <article><span>Season</span><strong>${summary.season_number}</strong><small>${escapeHtml(summary.season_id)}</small></article>
    <article><span>Phase</span><strong>${escapeHtml(summary.phase)}</strong><small>${summary.current_matchday ? `Matchday ${summary.current_matchday} of ${summary.maximum_matchday}` : 'Preseason control'}</small></article>
    <article><span>Registered</span><strong>${summary.registered_players}</strong><small>${summary.owned_players} owned</small></article>
    <article><span>Last saved</span><strong>${controlState.save?.updated_at ? new Date(controlState.save.updated_at).toLocaleTimeString() : '—'}</strong><small>${escapeHtml(controlState.save?.checksum?.slice(0, 12) || 'No checksum')}</small></article>` : '<p>No persistent save is attached to this appointment yet. Import an accepted save to begin.</p>';
  $('advanceWorld').disabled = !summary?.can_advance;
  const playerOptions = options();
  $('registrationPlayer').innerHTML = playerOptions;
  $('contractPlayer').innerHTML = playerOptions;
}

async function api(body = null) {
  if (!authorization) throw new Error('Portal session is not ready');
  const response = await nativeFetch('/api/world-control', {
    method: body ? 'POST' : 'GET',
    headers: { authorization, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'World control request failed');
  return data;
}

async function act(label, body) {
  const message = $('worldControlMessage');
  message.textContent = `${label}…`;
  document.querySelectorAll('#worldView button').forEach((button) => { button.disabled = true; });
  try {
    const data = await api(body);
    controlState = { ...controlState, ...data, has_save: true };
    render();
    message.textContent = `${label} complete.`;
    window.dispatchEvent(new CustomEvent('tbg:world-controlled', { detail: data }));
  } catch (error) {
    message.textContent = error.message;
  } finally {
    document.querySelectorAll('#worldView button').forEach((button) => { button.disabled = false; });
    if (controlState?.summary) $('advanceWorld').disabled = !controlState.summary.can_advance;
  }
}

function bind() {
  $('refreshWorldSave').addEventListener('click', async () => {
    try { controlState = await api(); render(); $('worldControlMessage').textContent = 'Latest save loaded.'; }
    catch (error) { $('worldControlMessage').textContent = error.message; }
  });
  $('advanceWorld').addEventListener('click', () => act('Advancing world', { type: 'advance' }));
  $('registerWorldPlayer').addEventListener('click', () => act('Registering player', { type: 'register_player', playerId: $('registrationPlayer').value }));
  $('unregisterWorldPlayer').addEventListener('click', () => act('Unregistering player', { type: 'unregister_player', playerId: $('registrationPlayer').value }));
  $('renewWorldContract').addEventListener('click', () => act('Renewing contract', { type: 'renew_contract', playerId: $('contractPlayer').value, years: Number($('contractYears').value) }));
  $('submitWorldTransfer').addEventListener('click', () => act('Completing transfer', {
    type: 'transfer_player', direction: $('transferDirection').value,
    playerId: $('transferPlayerId').value.trim(), otherClubId: $('transferClubId').value.trim(), fee: Number($('transferFee').value) || 0
  }));
  $('exportWorldSave').addEventListener('click', async () => {
    try {
      const data = await api({ type: 'export_save' });
      const blob = new Blob([data.saved_world], { type: 'application/json' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `${data.summary.world_id}-${data.summary.season_id}.json`;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (error) { $('worldControlMessage').textContent = error.message; }
  });
  $('importWorldSave').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    await act('Importing save', { type: 'import_save', saved_world: await file.text() });
    event.target.value = '';
  });
}

window.addEventListener('tbg:portal-rendered', async (event) => {
  bootstrap = event.detail;
  mount();
  try { controlState = await api(); render(); }
  catch (error) { $('worldControlMessage').textContent = error.message; }
});
