const nativeFetch = window.fetch.bind(window);
let authorization = '';
let registrationRepairPreview = null;

window.fetch = async (...args) => {
  const headers = args[1]?.headers || (args[0] instanceof Request ? args[0].headers : null);
  const auth = headers instanceof Headers ? headers.get('authorization') : headers?.authorization;
  if (auth) authorization = auth;
  return nativeFetch(...args);
};

const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));

function resultText(result) {
  if (!result?.accepted) return result?.error || 'Turn was not advanced.';
  return `Matchday ${result.matchday_advanced} complete · next matchday ${result.next_matchday ?? 'pending'} · checkpoint ${String(result.replacement_checksum || '').slice(0, 12)} · next turn ${result.next_turn_at ? new Date(result.next_turn_at).toLocaleString() : 'pending'}`;
}

function repairPreviewHtml(preview) {
  const changed = (preview.clubs || []).filter((club) => club.registrations_added.length || club.registrations_removed.length || club.free_agents_signed.length);
  const clubRows = changed.slice(0, 40).map((club) => {
    const details = [
      club.registrations_added.length ? `+${club.registrations_added.length} owned player${club.registrations_added.length === 1 ? '' : 's'} registered` : '',
      club.registrations_removed.length ? `−${club.registrations_removed.length} removed` : '',
      club.free_agents_signed.length ? `${club.free_agents_signed.length} free agent${club.free_agents_signed.length === 1 ? '' : 's'} signed` : '',
      `${club.registered_before} → ${club.final_registered} total registrations`
    ].filter(Boolean).join(' · ');
    return `<li><strong>${escapeHtml(club.club_name)}</strong>: ${escapeHtml(details)}</li>`;
  }).join('');
  const blocked = (preview.blocked || []).map((club) => `<li><strong>${escapeHtml(club.club_name)}</strong>: ${escapeHtml(club.coverage_gaps.map((gap) => `${gap.group} ${gap.registered}/${gap.required}`).join(', '))}</li>`).join('');
  const delta = Number(preview.net_registration_change || 0);
  const deltaText = delta === 0 ? 'no overall change' : `${delta > 0 ? '+' : ''}${delta} overall`;
  return `
    <p><strong>Preview only — no world data has changed.</strong></p>
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
  const result = await response.json();
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
      <button id="runDueTurnNow" class="primary-action" type="button">Run due turn now</button>
      <p id="runDueTurnResult" class="world-control-message" aria-live="polite"></p>
    </section>
    <section id="registrationRepairCard" class="world-control-card">
      <h3>Canonical squad registration repair</h3>
      <p>Preview a positionally viable registration plan against the external published free-agent catalogue. Only selected signings enter the canonical checkpoint.</p>
      <div class="world-control-actions">
        <button id="previewRegistrationRepair" type="button">Preview registration repair</button>
        <button id="applyRegistrationRepair" class="primary-action" type="button" disabled>Apply previewed repair</button>
      </div>
      <div id="registrationRepairResult" class="world-control-message" aria-live="polite"></div>
    </section>`);

  document.getElementById('runDueTurnNow').addEventListener('click', async () => {
    const button = document.getElementById('runDueTurnNow');
    const output = document.getElementById('runDueTurnResult');
    button.disabled = true;
    output.textContent = 'Claiming due world and running the production scheduler…';
    try {
      if (!authorization) throw new Error('Portal session is not ready');
      const response = await nativeFetch('/api/run-due-turn-now', { method: 'POST', headers: { authorization, 'content-type': 'application/json' }, body: '{}' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Production turn failed');
      output.innerHTML = escapeHtml(resultText(result));
      window.dispatchEvent(new CustomEvent('tbg:canonical-turn-complete', { detail: result }));
      window.location.reload();
    } catch (error) {
      output.textContent = error.message;
    } finally {
      button.disabled = false;
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
      window.location.reload();
    } catch (error) {
      output.textContent = error.message;
      previewButton.disabled = false;
    }
  });
}

window.addEventListener('tbg:portal-rendered', (event) => queueMicrotask(() => mount(event.detail)));
