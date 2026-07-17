import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const $ = (id) => document.getElementById(id);
let client;
let bootstrapState;
let presets = [];
let previousSheets = [];
let seedAppliedForContext = null;
let restoreObserver = null;
let activeRestoredSheet = null;
let applyingSheet = false;
let releaseRestoreListeners = null;

async function auth() {
  if (!client) {
    const response = await fetch('/api/auth-config', { cache: 'no-store' });
    const config = await response.json();
    client = createClient(config.supabase_url, config.supabase_anon_key, { auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
  }
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  return data.session;
}

async function api(path, options = {}) {
  const active = await auth();
  if (!active) throw new Error('Authentication required');
  const response = await fetch(path, { ...options, headers: { authorization: `Bearer ${active.access_token}`, ...(options.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Request failed');
  return body;
}

const selectedIds = (zone) => [...document.querySelectorAll(`input[data-zone="${zone}"]:checked`)].map((input) => String(input.value));
const sameIds = (left = [], right = []) => left.length === right.length && left.every((value, index) => String(value) === String(right[index]));

function captureSheet(name = '') {
  return {
    name,
    club_id: bootstrapState.club.tbg_club_id,
    formation: $('formation').value,
    starting_xi: selectedIds('xi'),
    bench: selectedIds('bench'),
    captain_id: $('captain').value || null,
    set_piece_takers: { penalties: $('captain').value, free_kicks: $('captain').value, corners_left: $('captain').value, corners_right: $('captain').value },
    tactics: {
      mentality: $('mentality').value,
      pressing: $('pressing').value,
      tempo: $('tempo').value,
      width: $('width').value,
      defensive_line: $('defensiveLine').value
    }
  };
}

function reorder(containerId, zone, orderedIds) {
  const container = $(containerId);
  if (!container) return;
  const labels = [...container.querySelectorAll('.player-pick')];
  const idOf = (label) => String(label.querySelector(`input[data-zone="${zone}"]`)?.value || '');
  const byId = new Map(labels.map((label) => [idOf(label), label]));
  const ordered = (orderedIds || []).map(String).filter((id) => byId.has(id));
  const selected = new Set(ordered);

  labels.forEach((label) => {
    const input = label.querySelector(`input[data-zone="${zone}"]`);
    if (input) input.checked = selected.has(String(input.value));
  });

  const desired = [...ordered, ...labels.map(idOf).filter((id) => !selected.has(id))];
  const current = labels.map(idOf);
  if (!sameIds(desired, current)) desired.forEach((id) => { const label = byId.get(id); if (label) container.appendChild(label); });
}

function sheetIsApplied(sheet) {
  return sameIds(selectedIds('xi'), (sheet.starting_xi || []).map(String).filter((id) => document.querySelector(`input[data-zone="xi"][value="${CSS.escape(id)}"]`)))
    && sameIds(selectedIds('bench'), (sheet.bench || []).map(String).filter((id) => document.querySelector(`input[data-zone="bench"][value="${CSS.escape(id)}"]`)));
}

function applySheet(sheet, sourceLabel = '') {
  if (!sheet || applyingSheet) return false;
  if (!$('startingXi')?.querySelector('input') || !$('bench')?.querySelector('input')) return false;
  applyingSheet = true;
  try {
    if (sheet.formation) $('formation').value = sheet.formation;
    const tactics = sheet.tactics || {};
    if (tactics.mentality) $('mentality').value = tactics.mentality;
    if (tactics.pressing) $('pressing').value = tactics.pressing;
    if (tactics.tempo) $('tempo').value = tactics.tempo;
    if (tactics.width) $('width').value = tactics.width;
    if (tactics.defensive_line) $('defensiveLine').value = tactics.defensive_line;
    reorder('startingXi', 'xi', sheet.starting_xi || []);
    reorder('bench', 'bench', sheet.bench || []);
    $('startingXi').querySelector('input')?.dispatchEvent(new Event('change', { bubbles: true }));
    queueMicrotask(() => {
      if (sheet.captain_id && [...$('captain').options].some((option) => option.value === String(sheet.captain_id))) $('captain').value = String(sheet.captain_id);
    });
    if (sourceLabel) setStatus(sourceLabel);
    return true;
  } finally {
    applyingSheet = false;
  }
}

function protectRestoredSheet(sheet) {
  activeRestoredSheet = sheet;
  restoreObserver?.disconnect();
  releaseRestoreListeners?.();
  const xi = $('startingXi');
  const bench = $('bench');
  if (!xi || !bench) return;

  const restore = () => {
    if (!activeRestoredSheet || applyingSheet || sheetIsApplied(activeRestoredSheet)) return;
    queueMicrotask(() => applySheet(activeRestoredSheet));
  };
  restoreObserver = new MutationObserver(restore);
  restoreObserver.observe(xi, { childList: true, subtree: true, attributes: true, attributeFilter: ['checked'] });
  restoreObserver.observe(bench, { childList: true, subtree: true, attributes: true, attributeFilter: ['checked'] });

  const release = (event) => {
    if (!event.isTrusted) return;
    const target = event.target instanceof Element ? event.target : null;
    const visibleBoardEdit = target?.closest('#interactiveFormationBoard');
    const legacyEdit = target?.closest('#startingXi, #bench');
    if (!visibleBoardEdit && !legacyEdit) return;
    activeRestoredSheet = null;
    restoreObserver?.disconnect();
    releaseRestoreListeners?.();
  };

  document.addEventListener('pointerdown', release, true);
  document.addEventListener('drop', release, true);
  document.addEventListener('keydown', release, true);
  xi.addEventListener('change', release, true);
  bench.addEventListener('change', release, true);
  releaseRestoreListeners = () => {
    document.removeEventListener('pointerdown', release, true);
    document.removeEventListener('drop', release, true);
    document.removeEventListener('keydown', release, true);
    xi.removeEventListener('change', release, true);
    bench.removeEventListener('change', release, true);
    releaseRestoreListeners = null;
  };
}

function applyAndProtect(sheet, label) {
  if (!applySheet(sheet, label)) return false;
  protectRestoredSheet(sheet);
  return true;
}

function setStatus(message, error = false) {
  const status = $('presetStatus');
  if (!status) return;
  status.className = `preset-status ${error ? 'error' : 'ok'}`;
  status.textContent = message;
}

function renderPresetOptions() {
  const select = $('teamPresetSelect');
  if (!select) return;
  select.innerHTML = '<option value="">Choose saved team sheet…</option>' + presets.map((preset) => `<option value="${preset.id}">${preset.name}</option>`).join('');
  $('deletePreset').disabled = !select.value;
}

function historyLabel(sheet) {
  const when = sheet.updated_at || sheet.submitted_at;
  const date = when ? new Date(when).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : 'previous match';
  return `${date} · ${sheet.fixture_id} · ${sheet.formation}`;
}

function renderPreviousOptions() {
  const select = $('previousMatchSelect');
  if (!select) return;
  select.innerHTML = '<option value="">Load team from previous match…</option>' + previousSheets.map((sheet, index) => `<option value="${index}">${historyLabel(sheet)}</option>`).join('');
  $('loadPreviousMatch').disabled = !select.value;
}

function installControls() {
  const form = $('decisionForm');
  if (!form || $('teamPresetPanel')) return;
  const panel = document.createElement('section');
  panel.id = 'teamPresetPanel';
  panel.className = 'team-preset-panel';
  panel.innerHTML = `
    <div class="preset-heading"><div><strong>Team sheets</strong><small>Carry forward your last selection, load a previous match, or save named presets.</small></div><span id="selectionSeedBadge" class="seed-badge" hidden></span></div>
    <div class="preset-controls previous-match-controls">
      <select id="previousMatchSelect" aria-label="Previous match teams"><option value="">Load team from previous match…</option></select>
      <button id="loadPreviousMatch" type="button" disabled>Load previous match</button>
    </div>
    <div class="preset-controls">
      <select id="teamPresetSelect" aria-label="Saved team sheets"><option value="">Choose saved team sheet…</option></select>
      <button id="loadPreset" type="button">Load</button>
      <button id="savePreset" type="button">Save current as…</button>
      <button id="updatePreset" type="button">Update selected</button>
      <button id="deletePreset" type="button" class="danger">Delete</button>
    </div>
    <p id="presetStatus" class="preset-status" aria-live="polite"></p>`;
  form.before(panel);

  $('previousMatchSelect').addEventListener('change', () => { $('loadPreviousMatch').disabled = $('previousMatchSelect').value === ''; });
  $('loadPreviousMatch').addEventListener('click', () => {
    const sheet = previousSheets[Number($('previousMatchSelect').value)];
    if (!sheet) return setStatus('Choose a previous match first.', true);
    applyAndProtect(sheet, `Loaded team and tactics from ${historyLabel(sheet)}.`);
    const badge = $('selectionSeedBadge');
    badge.hidden = false;
    badge.textContent = 'PREVIOUS MATCH';
  });

  $('teamPresetSelect').addEventListener('change', () => { $('deletePreset').disabled = !$('teamPresetSelect').value; $('updatePreset').disabled = !$('teamPresetSelect').value; });
  $('loadPreset').addEventListener('click', () => {
    const preset = presets.find((row) => row.id === $('teamPresetSelect').value);
    if (!preset) return setStatus('Choose a saved team sheet first.', true);
    applyAndProtect(preset, `Loaded “${preset.name}”. Changes affect this fixture only until you save.`);
  });
  $('savePreset').addEventListener('click', () => savePreset(false));
  $('updatePreset').addEventListener('click', () => savePreset(true));
  $('deletePreset').addEventListener('click', deletePreset);
  $('updatePreset').disabled = true;
  $('deletePreset').disabled = true;
}

async function loadPresets() {
  const clubId = bootstrapState?.club?.tbg_club_id;
  if (!clubId) return;
  const body = await api(`/api/team-presets?club_id=${encodeURIComponent(clubId)}`);
  presets = body.presets || [];
  renderPresetOptions();
}

async function savePreset(updateExisting) {
  try {
    let name;
    if (updateExisting) {
      const existing = presets.find((row) => row.id === $('teamPresetSelect').value);
      if (!existing) return setStatus('Choose a preset to update.', true);
      name = existing.name;
    } else {
      name = window.prompt('Name this team sheet:', 'Best XI')?.trim();
      if (!name) return;
    }
    setStatus('Saving team sheet…');
    const body = await api('/api/team-presets', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(captureSheet(name)) });
    await loadPresets();
    $('teamPresetSelect').value = body.preset.id;
    $('teamPresetSelect').dispatchEvent(new Event('change'));
    setStatus(`${updateExisting ? 'Updated' : 'Saved'} “${body.preset.name}”.`);
  } catch (error) { setStatus(error.message, true); }
}

async function deletePreset() {
  const id = $('teamPresetSelect').value;
  const preset = presets.find((row) => row.id === id);
  if (!preset || !window.confirm(`Delete “${preset.name}”?`)) return;
  try {
    await api(`/api/team-presets?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    await loadPresets();
    setStatus(`Deleted “${preset.name}”.`);
  } catch (error) { setStatus(error.message, true); }
}

async function carryForward() {
  const fixture = bootstrapState?.next_fixture || null;
  const club = bootstrapState?.club;
  if (!club) return;
  const contextKey = fixture?.fixture_id || `${club.tbg_club_id}:no-fixture`;
  if (seedAppliedForContext === contextKey) return;
  const fixtureQuery = fixture?.fixture_id ? `&fixture_id=${encodeURIComponent(fixture.fixture_id)}` : '';
  const body = await api(`/api/team-seed?club_id=${encodeURIComponent(club.tbg_club_id)}${fixtureQuery}`);
  previousSheets = body.history || [];
  renderPreviousOptions();
  if (!body.submission) return;

  let attempts = 0;
  const tryApply = () => {
    const sourceLabel = body.source === 'last_team'
      ? (fixture ? 'Last submitted team carried forward. Review availability before saving.' : 'Last submitted team restored. It will carry into the next fixture automatically.')
      : 'Current fixture submission restored.';
    if (applyAndProtect(body.submission, sourceLabel)) {
      seedAppliedForContext = contextKey;
      const badge = $('selectionSeedBadge');
      badge.hidden = false;
      badge.textContent = body.source === 'last_team' ? (fixture ? 'CARRIED FORWARD' : 'LAST TEAM') : 'CURRENT SUBMISSION';
      return;
    }
    attempts += 1;
    if (attempts < 100) setTimeout(tryApply, 100);
  };
  tryApply();
}

async function initialise() {
  const active = await auth();
  if (!active) return;
  const response = await fetch('/api/bootstrap', { headers: { authorization: `Bearer ${active.access_token}` }, cache: 'no-store' });
  bootstrapState = await response.json();
  if (!response.ok || !bootstrapState?.club) return;
  installControls();
  await Promise.all([loadPresets(), carryForward()]);
}

window.addEventListener('load', () => setTimeout(() => initialise().catch(console.error), 900));
document.addEventListener('submit', (event) => {
  if (event.target?.id === 'decisionForm') setTimeout(() => initialise().catch(console.error), 1400);
});