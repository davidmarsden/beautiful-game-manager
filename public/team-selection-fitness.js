export const FITNESS_DIALS = Object.freeze({
  match_cost_per_90: 35,
  recovery_per_rest_day: 9,
  warning_threshold: 70
});

const ROLE_DEMAND = Object.freeze({
  GK: 0.62, CB: 0.92, LCB: 0.92, RCB: 0.92,
  LB: 1.06, RB: 1.06, LWB: 1.16, RWB: 1.16,
  LDM: 1, RDM: 1, CM: 1.06, LCM: 1.06, RCM: 1.06,
  AM: 1.05, LM: 1.1, RM: 1.1, LW: 1.1, RW: 1.1,
  CF: 1, LCF: 1, RCF: 1, BENCH: 1
});

const PRESSING_DEMAND = Object.freeze({ low: 0.92, mid: 1, high: 1.18 });
const TEMPO_DEMAND = Object.freeze({ slow: 0.93, normal: 1, fast: 1.1 });
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const playerId = (player) => String(player?.tbg_player_id || player?.player_id || player?.id || '');

export function fitnessBand(value) {
  const fitness = clamp(number(value, 100), 0, 100);
  if (fitness >= 90) return { key: 'fresh', label: 'Fresh' };
  if (fitness >= 75) return { key: 'fit', label: 'Fit' };
  if (fitness >= 60) return { key: 'tired', label: 'Tired' };
  return { key: 'fatigued', label: 'Fatigued' };
}

export function recoveryDays(lastFixtureAt, nextFixtureAt) {
  if (!lastFixtureAt || !nextFixtureAt) return 0;
  const elapsed = (new Date(nextFixtureAt).getTime() - new Date(lastFixtureAt).getTime()) / 86400000;
  return Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0;
}

export function projectedKickoffFitness(currentFitness, days) {
  return clamp(number(currentFitness, 100) + Math.max(0, number(days)) * FITNESS_DIALS.recovery_per_rest_day, 0, 100);
}

export function projectedPostMatchFitness({ currentFitness, days = 0, role = 'BENCH', pressing = 'mid', tempo = 'normal', workRate = 50 } = {}) {
  const kickoffFitness = projectedKickoffFitness(currentFitness, days);
  const roleDemand = ROLE_DEMAND[String(role || 'BENCH').toUpperCase()] ?? 1;
  const pressingDemand = PRESSING_DEMAND[String(pressing || 'mid').toLowerCase()] ?? 1;
  const tempoDemand = TEMPO_DEMAND[String(tempo || 'normal').toLowerCase()] ?? 1;
  const workRateDemand = 0.9 + clamp(number(workRate, 50), 0, 100) / 500;
  const workload = clamp(roleDemand * pressingDemand * tempoDemand * workRateDemand, 0.55, 1.55);
  return clamp(kickoffFitness - FITNESS_DIALS.match_cost_per_90 * workload, 0, 100);
}

let portalState = null;
let playersById = new Map();
let refreshTimer = null;
let observer = null;
let observedTarget = null;
let originalTrayOrder = [];

const rounded = (value) => Math.round(number(value, 0));

function currentTactics() {
  return {
    pressing: document.getElementById('pressing')?.value || 'mid',
    tempo: document.getElementById('tempo')?.value || 'normal'
  };
}

function fixtureRecoveryDays() {
  return recoveryDays(
    portalState?.last_fixture?.kickoff_at || portalState?.last_fixture?.played_at,
    portalState?.next_fixture?.kickoff_at
  );
}

function playerProjection(player, role = 'BENCH') {
  const days = fixtureRecoveryDays();
  const current = clamp(number(player?.fitness, 100), 0, 100);
  const kickoff = projectedKickoffFitness(current, days);
  const tactics = currentTactics();
  const post = projectedPostMatchFitness({
    currentFitness: current,
    days,
    role,
    pressing: tactics.pressing,
    tempo: tactics.tempo,
    workRate: player?.work_rate_rating ?? player?.work_rate ?? player?.workrate ?? 50
  });
  return { current, kickoff, post, days, band: fitnessBand(current) };
}

function metricMarkup(player, role, bench = false) {
  const projection = playerProjection(player, role);
  const postLabel = bench ? 'If 90m' : 'After 90m';
  return `<span class="fitness-metrics fitness-${projection.band.key}" data-fitness-metrics>
    <span class="fitness-current"><strong>${rounded(projection.current)}%</strong> ${projection.band.label}</span>
    <small>Kick-off ${rounded(projection.kickoff)}% · ${postLabel} ${rounded(projection.post)}%</small>
  </span>`;
}

function decoratePitchAndBench() {
  document.querySelectorAll('#formationPitch .formation-slot, #formationBench .bench-slot').forEach((slot) => {
    const token = slot.querySelector('.player-token');
    const id = token?.dataset.playerId || slot.querySelector('[data-player-id]')?.dataset.playerId;
    const player = playersById.get(String(id || ''));
    if (!token || !player) return;
    token.querySelector('[data-fitness-metrics]')?.remove();
    const role = slot.dataset.role || 'BENCH';
    const projection = playerProjection(player, role);
    token.insertAdjacentHTML('beforeend', metricMarkup(player, role, slot.classList.contains('bench-slot')));
    slot.classList.toggle('low-fitness-selection', projection.kickoff < FITNESS_DIALS.warning_threshold);
    slot.title = `${player.display_name || player.name || id}: ${rounded(projection.current)}% now, ${rounded(projection.kickoff)}% projected at kick-off, ${rounded(projection.post)}% after 90 minutes`;
  });
}

function decorateTray() {
  const tray = document.getElementById('formationSquadTray');
  if (!tray) return;
  const buttons = [...tray.querySelectorAll('.tray-player')];
  if (!originalTrayOrder.length || originalTrayOrder.some((id) => !buttons.some((button) => button.dataset.playerId === id))) {
    originalTrayOrder = buttons.map((button) => button.dataset.playerId);
  }
  buttons.forEach((button) => {
    const player = playersById.get(String(button.dataset.playerId || ''));
    if (!player) return;
    button.querySelector('[data-fitness-metrics]')?.remove();
    const projection = playerProjection(player, 'BENCH');
    button.insertAdjacentHTML('beforeend', metricMarkup(player, 'BENCH', true));
    button.dataset.fitness = String(projection.current);
    button.dataset.kickoffFitness = String(projection.kickoff);
    button.classList.toggle('low-fitness-selection', projection.kickoff < FITNESS_DIALS.warning_threshold);
  });
  sortTray();
}

function selectedLowFitnessPlayers() {
  return [...document.querySelectorAll('#formationPitch .formation-slot.low-fitness-selection [data-player-id]')]
    .map((node) => playersById.get(String(node.dataset.playerId || '')))
    .filter(Boolean);
}

function renderRecoverySummary() {
  const toolbar = document.querySelector('.pitch-toolbar');
  if (!toolbar) return;
  let summary = document.getElementById('fitnessRecoverySummary');
  if (!summary) {
    summary = document.createElement('div');
    summary.id = 'fitnessRecoverySummary';
    summary.className = 'fitness-recovery-summary';
    toolbar.appendChild(summary);
  }
  const days = fixtureRecoveryDays();
  const recovery = Math.round(days * FITNESS_DIALS.recovery_per_rest_day);
  summary.innerHTML = `<strong>${days.toFixed(1)} recovery days</strong><small>Up to +${recovery} fitness before kick-off</small>`;

  const validation = document.getElementById('formationValidation');
  if (!validation) return;
  let warning = document.getElementById('fitnessSelectionWarning');
  if (!warning) {
    warning = document.createElement('div');
    warning.id = 'fitnessSelectionWarning';
    validation.parentElement.insertBefore(warning, validation);
  }
  const low = selectedLowFitnessPlayers();
  warning.className = low.length ? 'fitness-selection-warning active' : 'fitness-selection-warning';
  warning.textContent = low.length
    ? `Fitness warning: ${low.map((player) => player.display_name || player.name || playerId(player)).join(', ')} projected below ${FITNESS_DIALS.warning_threshold}% at kick-off.`
    : '';
}

function ensureSortControl() {
  const panel = document.querySelector('.squad-tray-panel');
  if (!panel || document.getElementById('fitnessSort')) return;
  const help = panel.querySelector('.pitch-help');
  const label = document.createElement('label');
  label.className = 'fitness-sort-control';
  label.innerHTML = `Sort squad<select id="fitnessSort">
    <option value="default">Position / rating</option>
    <option value="fitness-desc">Fitness: highest first</option>
    <option value="fitness-asc">Fitness: lowest first</option>
    <option value="kickoff-desc">Kick-off fitness: highest first</option>
  </select>`;
  help?.insertAdjacentElement('afterend', label);
  label.querySelector('select').addEventListener('change', sortTray);
}

function sortTray() {
  const tray = document.getElementById('formationSquadTray');
  const mode = document.getElementById('fitnessSort')?.value || 'default';
  if (!tray) return;
  const buttons = [...tray.querySelectorAll('.tray-player')];
  const originalIndex = new Map(originalTrayOrder.map((id, index) => [id, index]));
  buttons.sort((left, right) => {
    if (mode === 'fitness-desc') return number(right.dataset.fitness) - number(left.dataset.fitness);
    if (mode === 'fitness-asc') return number(left.dataset.fitness) - number(right.dataset.fitness);
    if (mode === 'kickoff-desc') return number(right.dataset.kickoffFitness) - number(left.dataset.kickoffFitness);
    return number(originalIndex.get(left.dataset.playerId), 999) - number(originalIndex.get(right.dataset.playerId), 999);
  });
  buttons.forEach((button) => tray.appendChild(button));
}

function observeBoard() {
  if (observer && observedTarget) observer.observe(observedTarget, { childList: true, subtree: true });
}

function refreshFitnessLayer() {
  if (!portalState || !document.getElementById('interactiveFormationBoard')) return;
  observer?.disconnect();
  try {
    ensureSortControl();
    decoratePitchAndBench();
    decorateTray();
    renderRecoverySummary();
  } finally {
    observeBoard();
  }
}

function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refreshFitnessLayer, 0);
}

function startObserver() {
  if (observer || typeof MutationObserver === 'undefined') return;
  observedTarget = document.getElementById('tacticsView') || document.body;
  observer = new MutationObserver(scheduleRefresh);
  observeBoard();
}

function install(state) {
  portalState = state;
  playersById = new Map((state?.squad || []).map((player) => [playerId(player), player]));
  startObserver();
  ['pressing', 'tempo', 'formation'].forEach((id) => document.getElementById(id)?.addEventListener('change', scheduleRefresh));
  scheduleRefresh();
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  window.addEventListener('tbg:portal-rendered', (event) => install(event.detail));
  window.addEventListener('load', () => setTimeout(scheduleRefresh, 700));
}
