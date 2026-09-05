const MAX_PLANS = 5;
const SCORE_STATES = [
  ['always', 'Always'],
  ['winning', 'If winning'],
  ['drawing', 'If drawing'],
  ['losing', 'If losing']
];

let portalState = window.tbgPortalState || null;
let hydratedFixtureId = null;
let dirty = false;
let boardObserver = null;

function text(value) {
  return String(value ?? '').trim();
}

function ensureStylesheet() {
  if (document.querySelector('link[href$="preset-substitutions.css"]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = './preset-substitutions.css';
  document.head.append(link);
}

function boardIds(selector, legacyZone) {
  const board = [...document.querySelectorAll(selector)]
    .map((slot) => text(slot.querySelector('.player-token')?.dataset.playerId))
    .filter(Boolean);
  if (board.length) return board;
  return [...document.querySelectorAll(`input[data-zone="${legacyZone}"]:checked`)]
    .map((input) => text(input.value))
    .filter(Boolean);
}

function startingXi() {
  return boardIds('#formationPitch .formation-slot', 'xi');
}

function bench() {
  return boardIds('#formationBench .bench-slot', 'bench');
}

function teamSheetReady() {
  return startingXi().length === 11 && bench().length === 7;
}

function playerDirectory() {
  const rows = Array.isArray(portalState?.squad) ? portalState.squad : [];
  return new Map(rows.map((player) => [
    text(player.tbg_player_id || player.player_id || player.id),
    text(player.display_name || player.player_name || player.name || player.tbg_player_id || player.player_id)
  ]));
}

function playerLabel(playerId) {
  return playerDirectory().get(playerId) || playerId;
}

function option(value, label) {
  const node = document.createElement('option');
  node.value = value;
  node.textContent = label;
  return node;
}

function playerSelect(kind, selected = '') {
  const select = document.createElement('select');
  select.className = `preset-sub-${kind}`;
  select.setAttribute('aria-label', kind === 'out' ? 'Player off' : 'Player on');
  const ids = kind === 'out' ? startingXi() : bench();
  select.append(option('', kind === 'out' ? 'Player off…' : 'Player on…'));
  for (const playerId of ids) select.append(option(playerId, playerLabel(playerId)));
  if (selected && !ids.includes(selected) && !teamSheetReady()) select.append(option(selected, playerLabel(selected)));
  select.value = ids.includes(selected) || (selected && !teamSheetReady()) ? selected : '';
  return select;
}

function scoreStateSelect(selected = 'always') {
  const select = document.createElement('select');
  select.className = 'preset-sub-score-state';
  select.setAttribute('aria-label', 'Score-state condition');
  for (const [value, label] of SCORE_STATES) select.append(option(value, label));
  select.value = SCORE_STATES.some(([value]) => value === selected) ? selected : 'always';
  return select;
}

function minuteInput(value = 60) {
  const input = document.createElement('input');
  input.type = 'number';
  input.min = '1';
  input.max = '90';
  input.step = '1';
  input.value = String(Number.isInteger(Number(value)) ? Number(value) : 60);
  input.className = 'preset-sub-minute';
  input.setAttribute('aria-label', 'Planned substitution minute');
  return input;
}

function planRow(plan = {}, index = 0) {
  const row = document.createElement('div');
  row.className = 'preset-sub-row';
  row.dataset.planId = text(plan.plan_id) || `plan-${index + 1}`;

  const minuteWrap = document.createElement('label');
  minuteWrap.className = 'preset-sub-minute-wrap';
  const minuteCaption = document.createElement('span');
  minuteCaption.textContent = 'Minute';
  minuteWrap.append(minuteCaption, minuteInput(plan.minute));

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'preset-sub-remove';
  remove.textContent = 'Remove';
  remove.setAttribute('aria-label', 'Remove preset substitution');

  row.append(
    minuteWrap,
    playerSelect('out', text(plan.player_out_id)),
    playerSelect('in', text(plan.player_in_id)),
    scoreStateSelect(text(plan.score_state) || 'always'),
    remove
  );
  return row;
}

function panel() {
  return document.getElementById('presetSubstitutionsPanel');
}

function rowsHost() {
  return document.getElementById('presetSubstitutionRows');
}

function updateAddButton() {
  const button = document.getElementById('addPresetSubstitution');
  if (!button) return;
  const count = rowsHost()?.querySelectorAll('.preset-sub-row').length || 0;
  button.disabled = count >= MAX_PLANS;
  button.textContent = count >= MAX_PLANS ? 'Five plans set' : 'Add substitution plan';
}

function syncPlayerOptions() {
  const host = rowsHost();
  if (!host) return;
  const ready = teamSheetReady();
  for (const row of host.querySelectorAll('.preset-sub-row')) {
    for (const [kind, ids] of [['out', startingXi()], ['in', bench()]]) {
      const select = row.querySelector(`.preset-sub-${kind}`);
      if (!select) continue;
      const previous = text(select.value);
      const placeholder = kind === 'out' ? 'Player off…' : 'Player on…';
      const options = [option('', placeholder), ...ids.map((playerId) => option(playerId, playerLabel(playerId)))];
      if (previous && !ids.includes(previous) && !ready) options.push(option(previous, playerLabel(previous)));
      select.replaceChildren(...options);
      select.value = ids.includes(previous) || (previous && !ready) ? previous : '';
    }
  }
}

function installBoardObserver() {
  const board = document.getElementById('interactiveFormationBoard');
  if (!board || board.dataset.presetSubsObserved === 'true') return;
  board.dataset.presetSubsObserved = 'true';
  boardObserver?.disconnect();
  boardObserver = new MutationObserver(() => syncPlayerOptions());
  boardObserver.observe(board, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-player-id'] });
}

function ensurePanel() {
  ensureStylesheet();
  const form = document.getElementById('decisionForm');
  if (!form) return null;
  let root = panel();
  if (root) {
    installBoardObserver();
    return root;
  }

  root = document.createElement('section');
  root.id = 'presetSubstitutionsPanel';
  root.className = 'team-presets-panel preset-substitutions-panel';
  root.innerHTML = `
    <div class="preset-sub-heading">
      <div>
        <h3>Match plans · preset substitutions</h3>
        <p>Set these before kickoff. The engine attempts them automatically when the condition is true — there are no live match controls.</p>
      </div>
      <span class="preset-sub-badge">Pre-match only</span>
    </div>
    <div id="presetSubstitutionRows" class="preset-sub-rows"></div>
    <div class="preset-sub-footer">
      <button id="addPresetSubstitution" type="button">Add substitution plan</button>
      <small>Up to five. If a planned change is impossible because a player is injured, dismissed, already substituted or otherwise unavailable, the engine skips it safely and may use its normal automatic fallback.</small>
    </div>`;

  const actions = form.querySelector('.team-submission-actions') || form.querySelector('button[type="submit"]');
  if (actions) actions.before(root);
  else form.append(root);

  root.addEventListener('click', (event) => {
    const add = event.target.closest('#addPresetSubstitution');
    if (add) {
      const host = rowsHost();
      if (!host || host.querySelectorAll('.preset-sub-row').length >= MAX_PLANS) return;
      host.append(planRow({}, host.querySelectorAll('.preset-sub-row').length));
      dirty = true;
      updateAddButton();
      return;
    }
    const remove = event.target.closest('.preset-sub-remove');
    if (remove) {
      remove.closest('.preset-sub-row')?.remove();
      dirty = true;
      updateAddButton();
    }
  });
  root.addEventListener('change', () => { dirty = true; });
  root.addEventListener('input', () => { dirty = true; });
  installBoardObserver();
  updateAddButton();
  return root;
}

function currentPlans(state = portalState) {
  const submission = state?.current_submission;
  const plans = submission?.match_plans || submission?.instruction?.match_plans || [];
  return Array.isArray(plans) ? plans : [];
}

function hydrate(state, { force = false } = {}) {
  if (state && typeof state === 'object') portalState = state;
  const root = ensurePanel();
  if (!root) return;
  const fixtureId = text(portalState?.next_fixture?.fixture_id || portalState?.current_submission?.fixture_id);
  if (!force && dirty && fixtureId === hydratedFixtureId) {
    syncPlayerOptions();
    return;
  }
  if (!force && fixtureId === hydratedFixtureId && rowsHost()?.children.length) {
    syncPlayerOptions();
    return;
  }
  const host = rowsHost();
  if (!host) return;
  host.replaceChildren(...currentPlans(portalState).slice(0, MAX_PLANS).map((plan, index) => planRow(plan, index)));
  hydratedFixtureId = fixtureId || null;
  dirty = false;
  updateAddButton();
}

function readPlans() {
  ensurePanel();
  const rows = [...(rowsHost()?.querySelectorAll('.preset-sub-row') || [])];
  if (rows.length > MAX_PLANS) throw new Error('A maximum of five preset substitutions can be saved.');
  return rows.map((row, index) => {
    const minute = Math.trunc(Number(row.querySelector('.preset-sub-minute')?.value));
    const playerOutId = text(row.querySelector('.preset-sub-out')?.value);
    const playerInId = text(row.querySelector('.preset-sub-in')?.value);
    const scoreState = text(row.querySelector('.preset-sub-score-state')?.value || 'always');
    if (!Number.isInteger(minute) || minute < 1 || minute > 90) throw new Error(`Preset substitution ${index + 1}: choose a minute between 1 and 90.`);
    if (!playerOutId) throw new Error(`Preset substitution ${index + 1}: choose the player to take off.`);
    if (!playerInId) throw new Error(`Preset substitution ${index + 1}: choose the player to bring on.`);
    if (!startingXi().includes(playerOutId)) throw new Error(`Preset substitution ${index + 1}: the player coming off must be in your starting XI.`);
    if (!bench().includes(playerInId)) throw new Error(`Preset substitution ${index + 1}: the player coming on must be on your bench.`);
    return {
      plan_id: text(row.dataset.planId) || `plan-${index + 1}`,
      minute,
      player_out_id: playerOutId,
      player_in_id: playerInId,
      score_state: scoreState
    };
  });
}

window.tbgPresetSubstitutions = Object.freeze({ readPlans, hydrate, syncPlayerOptions });
window.addEventListener('tbg:portal-rendered', (event) => hydrate(event.detail));
window.addEventListener('tbg:formation-board-ready', () => {
  installBoardObserver();
  syncPlayerOptions();
  hydrate(window.tbgPortalState || portalState);
});
window.addEventListener('tbg:team-submission-saved', (event) => hydrate(event.detail?.state || window.tbgPortalState, { force: true }));
window.addEventListener('DOMContentLoaded', () => hydrate(window.tbgPortalState));
window.addEventListener('load', () => hydrate(window.tbgPortalState));

hydrate(window.tbgPortalState);