const nativeFetch = window.fetch.bind(window);
let authorization = '';
let registrationRepairPreview = null;
let failureDiagnostics = null;

window.fetch = async (...args) => {
  const headers = args[1]?.headers || (args[0] instanceof Request ? args[0].headers : null);
  const auth = headers instanceof Headers ? headers.get('authorization') : headers?.authorization;
  if (auth) authorization = auth;
  return nativeFetch(...args);
};

const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));

async function responseJson(response, fallbackMessage) {
  const text = await response.text();
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(text || '{}');
    } catch {
      const excerpt = text.trim().slice(0, 500);
      throw new Error(`${fallbackMessage} (HTTP ${response.status}${excerpt ? ` · ${excerpt}` : ''})`);
    }
  }
  const excerpt = text.trim().replace(/\s+/g, ' ').slice(0, 500);
  throw new Error(`${fallbackMessage} (HTTP ${response.status}${excerpt ? ` · ${excerpt}` : ''})`);
}

function resultText(result) {
  if (!result?.accepted) {
    const references = [
      result?.operation_id ? `operation ${result.operation_id}` : '',
      result?.recovery_of_run_id ? `failed run ${result.recovery_of_run_id}` : ''
    ].filter(Boolean).join(' · ');
    return `${result?.error || 'Turn was not advanced.'}${references ? ` · ${references}` : ''}`;
  }
  return `Matchday ${result.matchday_advanced} complete · next matchday ${result.next_matchday ?? 'pending'} · checkpoint ${String(result.replacement_checksum || '').slice(0, 12)} · next turn ${result.next_turn_at ? new Date(result.next_turn_at).toLocaleString() : 'pending'}`;
}

function showReloadAction(label = 'Reload world state') {
  const button = document.getElementById('reloadWorldState');
  if (!button) return;
  button.textContent = label;
  button.hidden = false;
  button.disabled = false;
}

function clearRecoveredFailureState() {
  failureDiagnostics = { active: false, can_retry: false };
  const panel = document.getElementById('worldFailureDiagnostics');
  const button = document.getElementById('runDueTurnNow');
  if (panel) panel.innerHTML = '';
  if (button) {
    button.textContent = 'Turn complete — reload world';
    button.disabled = true;
  }
}

function diagnosticDetails(value, depth = 0) {
  if (value == null || depth > 2) return '';
  if (typeof value !== 'object') return escapeHtml(value);
  if (Array.isArray(value)) return value.slice(0, 8).map((item) => diagnosticDetails(item, depth + 1)).filter(Boolean).join(' · ');
  return Object.entries(value).slice(0, 12).map(([key, item]) => {
    const rendered = diagnosticDetails(item, depth + 1);
    return rendered ? `${escapeHtml(key)}: ${rendered}` : '';
  }).filter(Boolean).join('<br>');
}

function failureDiagnosticsHtml(details) {
  if (!details?.active) return '';
  const references = [
    details.failed_run_id ? `Failed run ${details.failed_run_id}` : '',
    details.operation_id ? `Operation ${details.operation_id}` : '',
    details.checksum ? `Checkpoint ${String(details.checksum).slice(0, 12)}` : ''
  ].filter(Boolean).join(' · ');
  const diagnostics = diagnosticDetails(details.diagnostics);
  return `
    <div class="world-failure-diagnostics" role="alert">
      <strong>Matchday ${escapeHtml(details.matchday ?? '—')} failed</strong>
      <p>${escapeHtml(details.error || 'The production turn failed without a recorded exception.')}</p>
      ${references ? `<small>${escapeHtml(references)}</small>` : ''}
      ${details.failed_at ? `<small>Failed ${escapeHtml(new Date(details.failed_at).toLocaleString())}</small>` : ''}
      ${diagnostics ? `<details><summary>Technical diagnostics</summary><p>${diagnostics}</p></details>` : ''}
      <p>${escapeHtml(details.recovery || '')}</p>
    </div>`;
}

async function loadFailureDiagnostics() {
  if (!authorization) throw new Error('Portal session is not ready');
  const response = await nativeFetch('/api/world-failure-diagnostics', { headers: { authorization } });
  const result = await responseJson(response, 'World failure diagnostics returned an invalid response');
  if (!response.ok) throw new Error(result.error || 'World failure diagnostics could not be loaded');
  failureDiagnostics = result;
  const panel = document.getElementById('worldFailureDiagnostics');
  const button = document.getElementById('runDueTurnNow');
  if (panel) panel.innerHTML = failureDiagnosticsHtml(result);
  if (button && result.active) {
    button.textContent = result.can_retry ? 'Retry failed turn' : 'Manual recovery required';
    button.disabled = !result.can_retry;
  }
  return result;
}

function repairPreviewHtml(preview) {
  const changed = (preview.clubs || []).filter((club) => club.registrations_added.length || club.registrations_removed.length || club.free_agents_signed.length);
  const clubRows = changed.slice(0, 40).map((club) => {
    const details = [
      club.registrations_added.length ? `+${club.registrations_added.length} owned player${club.registrations_added.length === 1 ? '' : 's'} registered` : '',
      club.registrations_removed.length ? `−${club.registrations_removed.length} removed` : '',
      club.free_agents_signed.length ? `${club.free_agents_signed.length} free agent${club.free_agents_signed.length === 1 ? '' : 's'} signed` : '',
      club.first_team_ready_youth ? `${club.first_team_ready_youth} first-team-ready youth` : '',
      `${club.registered_before} → ${club.final_registered} total registrations`
    ].filter(Boolean).join(' · ');
    return `<li><strong>${escapeHtml(club.club_name)}</strong>: ${escapeHtml(details)}</li>`;
  }).join('');
  const blocked = (preview.blocked || []).map((club) => `<li><strong>${escapeHtml(club.club_name)}</strong>: ${escapeHtml(club.coverage_gaps.map((gap) => `${gap.group} ${gap.registered}/${gap.required}`).join(', '))}</li>`).join('');
  const delta = Number(preview.net_registration_change || 0);
  const deltaText = delta === 0 ? 'no overall change' : `${delta > 0 ? '+' : ''}${delta} overall`;
  return `
    <p><strong>Preview only — no world data has changed.</strong></p>
    <p>Under-19 players rated ${preview.first_team_ready_youth_rating || 80}+ count towards first-team squad size and positional cover. ${preview.registered_first_team_ready_youth || 0} such youths would remain registered.</p>
    <p>${preview.reservoir_candidates_considered || 0} external free-agent candidates considered · only ${preview.reservoir_materialised_in_checkpoint || 0} selected signings would be added to the canonical checkpoint · ${preview.reservoir_candidates_remaining_external || 0} remain outside it.</p>
    <p>${preview.registered_before} total registrations before · ${preview.registered_after} after (${deltaText}).</p>
    <p>${preview.registrations_added} owned registrations added · ${preview.registrations_removed} removed · ${preview.free_agents_signed} free agents signed · ${preview.clubs_still_impossible} clubs still impossible.</p>
    ${clubRows ? `<details open><summary>Proposed club changes</summary><ul>${clubRows}</ul></details>` : '<p>No registration changes are required.</p>'}
    ${blocked ? `<details open><summary>Clubs still impossible to repair</summary><ul>${blocked}</ul></details>` : ''}
  `;
}

async function repairRequest(action, expectedChecksum, expectedReservoirFingerprint) {
  if (!authorization) throw new Error('Portal session is not ready');
  const response = await nativeFetch('/api/repair-canonical-registrations', {
    method: 'POST',
    headers: { authorization, 'content-type': 'application/json' },
    body: JSON.stringify({ action, expected_checksum: expectedChecksum || null, expected_reservoir_fingerprint: expectedReservoirFingerprint || null })
  });
  const result = await responseJson(response, 'Canonical registration repair returned an invalid response');
  if (!response.ok) throw new Error(result.error || 'Canonical registration repair failed');
  return result;
}

function mount(bootstrap) {
  if (!bootstrap?.manager?.is_admin || document.getElementById('runDueTurnCard')) return;
  const worldView = document.getElementById('worldView');
  const controls = document.getElementById('worldControls');
  if (!worldView || !controls) return;
  controls.insertAdjacentHTML('beforebegin', `
    <section id="runDueTurnCard" class="world-control-card">
      <h3>Production turn operation</h3>
      <p>Run the due canonical turn through the same scheduled production path. The operation rejects early, duplicate and replayed execution.</p>
      <div id="worldFailureDiagnostics"></div>
      <div class="world-control-actions">
        <button id="runDueTurnNow" class="primary-action" type="button">Run due turn now</button>
        <button id="reloadWorldState" type="button" hidden>Reload world state</button>
      </div>
      <p id="runDueTurnResult" class="world-control-message" aria-live="polite"></p>
    </section>
    <section id="registrationRepairCard" class="world-control-card">
      <h3>Canonical squad registration repair</h3>
      <p>Preview a positionally viable registration plan against the external published free-agent catalogue. High-rated youth count when they are first-team ready; only selected signings enter the canonical checkpoint.</p>
      <div class="world-control-actions">
        <button id="previewRegistrationRepair" type="button">Preview registration repair</button>
        <button id="applyRegistrationRepair" class="primary-action" type="button" disabled>Apply previewed repair</button>
      </div>
      <div id="registrationRepairResult" class="world-control-message" aria-live="polite"></div>
    </section>`);

  loadFailureDiagnostics().catch((error) => {
    const panel = document.getElementById('worldFailureDiagnostics');
    if (panel) panel.innerHTML = `<p>${escapeHtml(error.message)}</p>`;
  });

  document.getElementById('reloadWorldState').addEventListener('click', () => window.location.reload());

  document.getElementById('runDueTurnNow').addEventListener('click', async () => {
    const button = document.getElementById('runDueTurnNow');
    const output = document.getElementById('runDueTurnResult');
    const reloadButton = document.getElementById('reloadWorldState');
    let turnCompleted = false;
    button.disabled = true;
    if (reloadButton) reloadButton.hidden = true;
    output.textContent = failureDiagnostics?.active ? 'Reopening the failed checkpoint and retrying the production scheduler…' : 'Claiming due world and running the production scheduler…';
    try {
      if (!authorization) throw new Error('Portal session is not ready');
      const response = await nativeFetch('/api/run-due-turn-now', { method: 'POST', headers: { authorization, 'content-type': 'application/json' }, body: '{}' });
      const result = await responseJson(response, 'Production turn response was interrupted');
      output.textContent = resultText(result);
      if (!response.ok) {
        await loadFailureDiagnostics().catch(() => {});
        showReloadAction();
        return;
      }
      turnCompleted = true;
      clearRecoveredFailureState();
      window.dispatchEvent(new CustomEvent('tbg:canonical-turn-complete', { detail: result }));
      showReloadAction('Reload completed world');
    } catch (error) {
      output.textContent = error.message;
      await loadFailureDiagnostics().catch(() => {});
      showReloadAction();
    } finally {
      if (!turnCompleted) button.disabled = Boolean(failureDiagnostics?.active && !failureDiagnostics?.can_retry);
    }
  });

  document.getElementById('previewRegistrationRepair').addEventListener('click', async () => {
    const previewButton = document.getElementById('previewRegistrationRepair');
    const applyButton = document.getElementById('applyRegistrationRepair');
    const output = document.getElementById('registrationRepairResult');
    previewButton.disabled = true;
    applyButton.disabled = true;
    registrationRepairPreview = null;
    output.textContent = 'Building a preview from the current checkpoint and external free-agent catalogue…';
    try {
      const result = await repairRequest('preview');
      registrationRepairPreview = result.preview;
      output.innerHTML = repairPreviewHtml(result.preview);
      applyButton.disabled = !result.preview.accepted;
    } catch (error) {
      output.textContent = error.message;
    } finally {
      previewButton.disabled = false;
    }
  });

  document.getElementById('applyRegistrationRepair').addEventListener('click', async () => {
    const previewButton = document.getElementById('previewRegistrationRepair');
    const applyButton = document.getElementById('applyRegistrationRepair');
    const output = document.getElementById('registrationRepairResult');
    if (!registrationRepairPreview?.source_checksum || !registrationRepairPreview?.reservoir_fingerprint) return;
    previewButton.disabled = true;
    applyButton.disabled = true;
    output.textContent = 'Applying the previewed repair to the unchanged canonical checkpoint…';
    try {
      const result = await repairRequest('apply', registrationRepairPreview.source_checksum, registrationRepairPreview.reservoir_fingerprint);
      output.textContent = `Registration repair applied. Checkpoint ${String(result.previous_checksum).slice(0, 12)} → ${String(result.replacement_checksum).slice(0, 12)}.`;
      window.dispatchEvent(new CustomEvent('tbg:canonical-registration-repaired', { detail: result }));
      showReloadAction('Reload repaired world');
    } catch (error) {
      output.textContent = error.message;
      previewButton.disabled = false;
    }
  });
}

window.addEventListener('tbg:portal-rendered', (event) => queueMicrotask(() => mount(event.detail)));
