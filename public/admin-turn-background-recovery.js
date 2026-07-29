(() => {
  const sleep = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

  async function statusRequest() {
    const authorization = window.tbgPortalAuthorization || '';
    if (!authorization) throw new Error('Portal session is not ready');
    const response = await fetch('/api/world-turn-status', { headers: { authorization } });
    const text = await response.text();
    let result = {};
    try { result = text ? JSON.parse(text) : {}; } catch {}
    if (!response.ok) throw new Error(result.error || `Turn status returned HTTP ${response.status}`);
    return result;
  }

  function statusText(status) {
    const run = status.run || {};
    if (status.state === 'processing') return `Matchday ${run.matchday || status.matchday || '—'} is processing in the background${run.id ? ` · run ${run.id}` : ''}.`;
    if (status.state === 'complete') return `Matchday ${run.matchday || '—'} complete · checkpoint ${String(status.checksum || '').slice(0, 12)} · next matchday ${status.matchday || 'pending'}.`;
    if (status.state === 'failed') {
      const stage = status.diagnostics?.failing_stage ? ` · failing stage ${status.diagnostics.failing_stage}` : '';
      return `${run.error_message || 'The background turn failed.'}${stage}${run.id ? ` · run ${run.id}` : ''}`;
    }
    return `Background turn queued · world status ${status.turn_status || status.state || 'pending'}.`;
  }

  async function pollUntilSettled(output, button) {
    const deadline = Date.now() + (12 * 60 * 1000);
    let sawProcessing = false;
    let transientErrors = 0;
    while (Date.now() < deadline) {
      await sleep(3000);
      try {
        const status = await statusRequest();
        transientErrors = 0;
        if (status.state === 'processing') sawProcessing = true;
        output.textContent = statusText(status);
        if (status.state === 'failed') {
          button.disabled = false;
          button.textContent = 'Retry failed turn';
          document.getElementById('reloadWorldState')?.removeAttribute('hidden');
          return;
        }
        if (status.state === 'complete' && (sawProcessing || status.run?.status === 'complete')) {
          button.disabled = true;
          button.textContent = 'Turn complete — reload world';
          const reload = document.getElementById('reloadWorldState');
          if (reload) {
            reload.hidden = false;
            reload.textContent = 'Reload completed world';
          }
          window.dispatchEvent(new CustomEvent('tbg:canonical-turn-background-complete', { detail: status }));
          return;
        }
      } catch (error) {
        transientErrors += 1;
        output.textContent = `Background turn is still queued; status check temporarily failed (${error.message}).`;
        if (transientErrors >= 10) {
          button.disabled = false;
          const reload = document.getElementById('reloadWorldState');
          if (reload) reload.hidden = false;
          return;
        }
      }
    }
    output.textContent = 'The background turn is still running or its status could not be confirmed. Reload world state before attempting another run.';
    const reload = document.getElementById('reloadWorldState');
    if (reload) reload.hidden = false;
  }

  document.addEventListener('click', async (event) => {
    const button = event.target.closest?.('#runDueTurnNow');
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();

    const output = document.getElementById('runDueTurnResult');
    const reload = document.getElementById('reloadWorldState');
    const authorization = window.tbgPortalAuthorization || '';
    button.disabled = true;
    if (reload) reload.hidden = true;
    if (output) output.textContent = 'Queueing the production turn in the background…';

    try {
      if (!authorization) throw new Error('Portal session is not ready');
      const response = await fetch('/api/run-due-turn-now-background', {
        method: 'POST',
        headers: { authorization, 'content-type': 'application/json' },
        body: '{}'
      });
      if (response.status !== 202 && !response.ok) {
        const text = await response.text();
        throw new Error(`Background turn could not be queued (HTTP ${response.status}${text ? ` · ${text.slice(0, 300)}` : ''})`);
      }
      button.textContent = 'Turn running in background';
      if (output) output.textContent = 'Production turn queued. This page will check the canonical run ledger every few seconds; no long browser connection is being held open.';
      await pollUntilSettled(output, button);
    } catch (error) {
      if (output) output.textContent = error.message;
      button.disabled = false;
      if (reload) reload.hidden = false;
    }
  }, true);
})();
