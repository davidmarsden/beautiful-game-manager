import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const $ = (id) => document.getElementById(id);
let client;
let session;
let bootstrapState;
let presets = [];
let seedAppliedForFixture = null;

async function auth() {
  if (!client) {
    const response = await fetch('/api/auth-config', { cache: 'no-store' });
    const config = await response.json();
    client = createClient(config.supabase_url, config.supabase_anon_key, { auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
  }
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  session = data.session;
  return session;
}

async function api(path, options = {}) {
  const active = await auth();
  if (!active) throw new Error('Authentication required');
  const response = await fetch(path, { ...options, headers: { authorization: `Bearer ${active.access_token}`, ...(options.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Request failed');
  return body;
}

function captureSheet(name = '') {
  const startingXi = [...document.querySelectorAll('input[data-zone="xi"]:checked')].map((input) => input.value);
  const bench = [...document.querySelectorAll('input[data-zone="bench"]:checked')].map((input) => input.value);
  return {
    name,
    club_id: bootstrapState.club.tbg_club_id,
    formation: $('formation').value,
    starting_xi: startingXi,
    bench,
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
  const byId = new Map(labels.map((label) => [String(label.querySelector(`input[data-zone="${zone}"]`)?.value || ''), label]));
  const selected = new Set((orderedIds || []).map(String));
  labels.forEach((label) => {
    const input = label.querySelector(`input[data-zone="${zone}"]`);
    if (input) input.checked = selected.has(String(input.value));
  });
  [...selected].forEach((id) => { const label = byId.get(id); if (label) container.appendChild(label); });
  labels.forEach((label) => { const id = String(label.querySelector(`input[data-zone="${zone}"]`)?.value || ''); if (!selected.has(id)) container.appendChild(label); });
}

function applySheet(sheet, sourceLabel = '') {
  if (!sheet) return false;
  if (!$('startingXi')?.querySelector('input') || !$('bench')?.querySelector('input')) return false;
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
  queueMicrotask(() => { if (sheet.captain_id && [...$('captain').options].some((option) => option.value === String(sheet.captain_id))) $('captain').value = String(sheet.captain_id); });
  const status = $('presetStatus');
  if (status && sourceLabel) { status.className = 'preset-status ok'; status.textContent = sourceLabel; }
  return true;
}

function renderPresetOptions() {
  const select = $('teamPresetSelect');
  if (!select) return;
  select.innerHTML = '<option value="">Choose saved team sheet…</option>' + presets.map((preset) => `<option value="${preset.id}">${preset.name}</option>`).join('');
  $('deletePreset').disabled = !select.value;
}

function installControls() {
  const form = $('decisionForm');
  if (!form || $('teamPresetPanel')) return;
  const panel = document.createElement('section');
  panel.id = 'teamPresetPanel';
  panel.className = 'team-preset-panel';
  panel.innerHTML = `
    <div class="preset-heading"><div><strong>Team sheets</strong><small>Carry forward your last selection or save named presets.</small></div><span id="selectionSeedBadge" class="seed-badge" hidden></span></div>
    <div class="preset-controls">
      <select id="teamPresetSelect" aria-label="Saved team sheets"><option value="">Choose saved team sheet…</option></select>
      <button id="loadPreset" type="button">Load</button>
      <button id="savePreset" type="button">Save current as…</button>
      <button id="updatePreset" type="button">Update selected</button>
      <button id="deletePreset" type="button" class="danger">Delete</button>
    </div>
    <p id="presetStatus" class="preset-status" aria-live="polite"></p>`;
  form.before(panel);
  $('teamPresetSelect').addEventListener('change', () => { $('deletePreset').disabled = !$('teamPresetSelect').value; $('updatePreset').disabled = !$('teamPresetSelect').value; });
  $('loadPreset').addEventListener('click', () => {
    const preset = presets.find((row) => row.id === $('teamPresetSelect').value);
    if (!preset) return setStatus('Choose a saved team sheet first.', true);
    applySheet(preset, `Loaded “${preset.name}”. Changes affect this fixture only until you save.`);
  });
  $('savePreset').addEventListener('click', () => savePreset(false));
  $('updatePreset').addEventListener('click', () => savePreset(true));
  $('deletePreset').addEventListener('click', deletePreset);
  $('updatePreset').disabled = true;
  $('deletePreset').disabled = true;
}

function setStatus(message, error = false) {
  const status = $('presetStatus');
  if (!status) return;
  status.className = `preset-status ${error ? 'error' : 'ok'}`;
  status.textContent = message;
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
    const sheet = captureSheet(name);
    const body = await api('/api/team-presets', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(sheet) });
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
  const fixture = bootstrapState?.next_fixture;
  const club = bootstrapState?.club;
  if (!fixture || !club || seedAppliedForFixture === fixture.fixture_id) return;
  const body = await api(`/api/team-seed?club_id=${encodeURIComponent(club.tbg_club_id)}&fixture_id=${encodeURIComponent(fixture.fixture_id)}`);
  if (!body.submission) return;
  let attempts = 0;
  const tryApply = () => {
    if (applySheet(body.submission, body.source === 'last_team' ? 'Last submitted team carried forward. Review availability before saving.' : 'Current fixture submission restored.')) {
      seedAppliedForFixture = fixture.fixture_id;
      const badge = $('selectionSeedBadge');
      if (badge) { badge.hidden = false; badge.textContent = body.source === 'last_team' ? 'CARRIED FORWARD' : 'CURRENT SUBMISSION'; }
      return;
    }
    attempts += 1;
    if (attempts < 80) setTimeout(tryApply, 100);
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