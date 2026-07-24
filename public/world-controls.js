const $ = (id) => document.getElementById(id);
const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));

let authorization = '';
let bootstrap = null;
let sharedState = null;

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
  tabs.insertAdjacentHTML('beforeend', '<button data-view="world">World</button>');
  workspace.insertAdjacentHTML('beforeend', `
    <div id="worldView" class="view">
      <div class="world-control-heading">
        <div><h2>Shared World</h2><p>One canonical TBG world, advanced automatically for every manager at the scheduled turn.</p></div>
        <span id="worldControlStatus" class="world-control-status">Checking world…</span>
      </div>
      <section id="worldControlSummary" class="world-control-summary"></section>
      <section id="worldInitializer" class="world-control-card" hidden>
        <h3>Initialize shared world</h3>
        <p>Create the first authoritative world from the approved published club and player data. This can only be done once.</p>
        <button id="initializeWorld" class="primary-action" type="button">Initialize canonical world</button>
      </section>
      <section id="worldControls" class="world-control-grid">
        <article class="world-control-card">
          <h3>Next scheduled turn</h3>
          <p id="turnDeadline">The next deadline is loading.</p>
          <p id="turnSubmissionState">No team instructions submitted yet.</p>
        </article>
        <article class="world-control-card">
          <h3>Team submission</h3>
          <p>Submit or revise your team instructions before the deadline. The world advances centrally; individual managers cannot trigger fixtures.</p>
          <label>Formation<select id="turnFormation"><option value="">Use current/default</option><option>4-3-3-wide</option><option>4-2-3-1</option><option>4-4-2</option><option>4-1-4-1</option><option>3-5-2</option><option>3-4-3</option><option>5-3-2</option></select></label>
          <label>Mentality<select id="turnMentality"><option value="">Use current/default</option><option value="cautious">Cautious</option><option value="balanced">Balanced</option><option value="positive">Positive</option><option value="attacking">Attacking</option></select></label>
          <button id="submitTurn" class="primary-action" type="button">Submit for next fixture</button>
        </article>
        <article class="world-control-card">
          <h3>Registration request</h3>
          <label>Owned player<select id="registrationPlayer"></select></label>
          <div class="world-control-actions"><button id="registerWorldPlayer" type="button">Request registration</button><button id="unregisterWorldPlayer" type="button">Request removal</button></div>
        </article>
        <article class="world-control-card">
          <h3>Contract request</h3>
          <label>Owned player<select id="contractPlayer"></select></label>
          <label>Extension<select id="contractYears"><option value="1">1 season</option><option value="2" selected>2 seasons</option><option value="3">3 seasons</option><option value="4">4 seasons</option><option value="5">5 seasons</option></select></label>
          <button id="renewWorldContract" type="button">Submit renewal request</button>
        </article>
        <article class="world-control-card world-transfer-card">
          <h3>Transfer request</h3>
          <p>Requests enter the shared-world command ledger. They do not directly remove a player from another manager's club.</p>
          <label>Action<select id="transferDirection"><option value="sell">List owned player</option><option value="buy">Submit transfer offer</option></select></label>
          <label>Player ID<input id="transferPlayerId" autocomplete="off" placeholder="tbg-player-id"></label>
          <label>Other club ID<input id="transferClubId" autocomplete="off" placeholder="tbg-club-id"></label>
          <label>Fee<input id="transferFee" type="number" min="0" step="1" value="0"></label>
          <button id="submitWorldTransfer" type="button">Submit request</button>
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

function playerOptions() {
  const squad = bootstrap?.squad || [];
  return squad.map((player) => `<option value="${escapeHtml(player.tbg_player_id)}">${escapeHtml(player.display_name || player.tbg_player_id)}</option>`).join('');
}

function countdown(value) {
  if (!value) return 'Schedule pending';
  const difference = new Date(value).getTime() - Date.now();
  if (difference <= 0) return 'Turn is due and will be processed centrally';
  const hours = Math.floor(difference / 3600000);
  const minutes = Math.floor((difference % 3600000) / 60000);
  return `${new Date(value).toLocaleString()} · ${hours}h ${minutes}m remaining`;
}

function render() {
  const summary = sharedState?.summary;
  const world = sharedState?.world;
  const submission = sharedState?.submission;
  const hasWorld = Boolean(sharedState?.has_world && world);
  const isAdmin = Boolean(sharedState?.is_admin ?? bootstrap?.manager?.is_admin);
  $('worldControlStatus').textContent = hasWorld ? `World ${world.turn_status}` : 'Not initialized';
  $('worldControlSummary').innerHTML = summary ? `
    <article><span>Season</span><strong>${summary.season_number}</strong><small>${escapeHtml(summary.season_id)}</small></article>
    <article><span>Phase</span><strong>${escapeHtml(summary.phase)}</strong><small>${summary.current_matchday ? `Matchday ${summary.current_matchday} of ${summary.maximum_matchday}` : 'Preseason'}</small></article>
    <article><span>Your club</span><strong>${escapeHtml(sharedState.appointment?.club_name || summary.club_name || sharedState.appointment?.club_id || '—')}</strong><small>Shared canonical world</small></article>
    <article><span>Checkpoint</span><strong>${world?.updated_at ? new Date(world.updated_at).toLocaleTimeString() : '—'}</strong><small>${escapeHtml(world?.checksum?.slice(0, 12) || 'No checksum')}</small></article>` : `<p>${escapeHtml(sharedState?.message || 'The shared world has not yet been initialized.')}</p>`;
  $('worldInitializer').hidden = hasWorld || !isAdmin;
  $('worldControls').hidden = !hasWorld;
  $('turnDeadline').textContent = countdown(world?.next_turn_at);
  $('turnSubmissionState').textContent = submission
    ? `${submission.status[0].toUpperCase()}${submission.status.slice(1)} ${new Date(submission.submitted_at).toLocaleString()}`
    : 'No team instructions submitted for this turn.';
  $('submitTurn').disabled = !hasWorld || world?.turn_status !== 'open';
  const options = playerOptions();
  $('registrationPlayer').innerHTML = options;
  $('contractPlayer').innerHTML = options;
}

async function api(body = null) {
  if (!authorization) throw new Error('Portal session is not ready');
  const response = await nativeFetch('/api/shared-world', {
    method: body ? 'POST' : 'GET',
    headers: { authorization, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Shared-world request failed');
  return data;
}

async function initializeWorld() {
  const message = $('worldControlMessage');
  message.textContent = 'Initializing canonical world…';
  $('initializeWorld').disabled = true;
  try {
    const response = await nativeFetch('/api/initialize-canonical-world', {
      method: 'POST',
      headers: { authorization, 'content-type': 'application/json' },
      body: '{}'
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Canonical-world initialization failed');
    message.textContent = `Shared world initialized: ${data.summary.club_count} clubs and ${data.summary.player_count} players.`;
    sharedState = await api();
    render();
  } catch (error) {
    message.textContent = error.message;
  } finally {
    $('initializeWorld').disabled = false;
  }
}

async function act(label, body) {
  const message = $('worldControlMessage');
  message.textContent = `${label}…`;
  document.querySelectorAll('#worldView button').forEach((button) => { button.disabled = true; });
  try {
    const data = await api(body);
    message.textContent = `${label} complete.`;
    sharedState = await api();
    render();
    window.dispatchEvent(new CustomEvent('tbg:world-submission', { detail: data }));
  } catch (error) {
    message.textContent = error.message;
  } finally {
    document.querySelectorAll('#worldView button').forEach((button) => { button.disabled = false; });
    if (sharedState?.world) $('submitTurn').disabled = sharedState.world.turn_status !== 'open';
  }
}

function bind() {
  $('initializeWorld').addEventListener('click', initializeWorld);
  $('submitTurn').addEventListener('click', () => {
    const formation = $('turnFormation').value;
    const mentality = $('turnMentality').value;
    act('Submitting team instructions', {
      type: 'submit_turn',
      instruction: {
        ...(formation ? { formation } : {}),
        ...(mentality ? { tactics: { mentality } } : {})
      }
    });
  });
  $('registerWorldPlayer').addEventListener('click', () => act('Submitting registration request', {
    type: 'submit_command', command_type: 'register_player', command_payload: { playerId: $('registrationPlayer').value }
  }));
  $('unregisterWorldPlayer').addEventListener('click', () => act('Submitting registration removal', {
    type: 'submit_command', command_type: 'unregister_player', command_payload: { playerId: $('registrationPlayer').value }
  }));
  $('renewWorldContract').addEventListener('click', () => act('Submitting contract request', {
    type: 'submit_command', command_type: 'renew_contract', command_payload: { playerId: $('contractPlayer').value, years: Number($('contractYears').value) }
  }));
  $('submitWorldTransfer').addEventListener('click', () => {
    const direction = $('transferDirection').value;
    act('Submitting transfer request', {
      type: 'submit_command',
      command_type: direction === 'sell' ? 'transfer_listing' : 'transfer_offer',
      command_payload: {
        direction,
        playerId: $('transferPlayerId').value.trim(),
        otherClubId: $('transferClubId').value.trim(),
        fee: Number($('transferFee').value) || 0
      }
    });
  });
}

window.addEventListener('tbg:portal-rendered', async (event) => {
  bootstrap = event.detail;
  mount();
  try { sharedState = await api(); render(); }
  catch (error) { $('worldControlStatus').textContent = 'World unavailable'; $('worldControlMessage').textContent = error.message; }
});
