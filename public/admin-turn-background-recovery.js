(() => {
  const sleep = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

  async function statusRequest() {
    const authorization = window.tbgPortalAuthorization || '';
    if (!authorization) throw new Error('Portal session is not ready');
    const response = await fetch('/api/world-turn-status', { headers: { authorization } });
    const text = await response.text();
    let result = {};
    try { result = text ? JSON.parse(text) : {}; } catch {}
    if (!response.ok) {
      const error = new Error(result.error || `Turn status returned HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return result;
  }

  function statusText(status) {
    const run = status.run || {};
    if (status.state === 'processing') return `Matchday ${run.matchday || status.matchday || '—'} is processing in the background${run.id ? ` · run ${run.id}` : ''}.`;
    if (status.state === 'reconciliation_required') return `${run.error_message || 'The checkpoint write could not be confirmed.'} The canonical lock and manager submissions have been preserved for recovery${run.id ? ` · run ${run.id}` : ''}.`;
    if (status.state === 'complete') return `Matchday ${run.matchday || '—'} complete · checkpoint ${String(status.checksum || '').slice(0, 12)} · next matchday ${status.matchday || 'pending'}.`;
    if (status.state === 'failed') {
      const stage = status.diagnostics?.failing_stage ? ` · failing stage ${status.diagnostics.failing_stage}` : '';
      return `${run.error_message || 'The background turn failed.'}${stage}${run.id ? ` · run ${run.id}` : ''}`;
    }
    return `Background turn queued · world status ${status.turn_status || status.state || 'pending'}.`;
  }

  function isRetriableStatusFailure(error) {
    return !Number.isInteger(error?.status) || error.status === 408 || error.status === 429 || error.status >= 500;
  }

  function isNewerThanQueuedBaseline(status, baseline, queuedServerAt, sawProcessing) {
    if (status.state === 'processing') return true;
    if (sawProcessing && (status.state === 'complete' || status.state === 'failed')) return true;
    if (sawProcessing && status.state === 'reconciliation_required') return true;
    if (!baseline.unavailable && status.run?.id && status.run.id !== baseline.run?.id) return true;
    if (!baseline.unavailable && status.operation_id && status.operation_id !== baseline.operation_id) return true;
    if (queuedServerAt && status.operation_created_at && new Date(status.operation_created_at).getTime() >= queuedServerAt) return true;
    if (!baseline.unavailable && status.checksum && baseline.checksum && status.checksum !== baseline.checksum) return true;
    return false;
  }

  async function pollUntilSettled(output, button, baseline, queuedServerAt) {
    const deadline = Date.now() + (12 * 60 * 1000);
    let sawProcessing = false;
    let transientErrors = 0;
    while (Date.now() < deadline) {
      await sleep(10000);
      try {
        const status = await statusRequest();
        transientErrors = 0;
        const belongsToQueuedAttempt = isNewerThanQueuedBaseline(status, baseline, queuedServerAt, sawProcessing);
        if (status.state === 'processing' && belongsToQueuedAttempt) {
          sawProcessing = true;
          button.textContent = 'Turn running in background';
        }
        output.textContent = belongsToQueuedAttempt
          ? statusText(status)
          : 'Production turn queued. Waiting for the background worker to claim the failed checkpoint…';
        if (status.state === 'reconciliation_required' && belongsToQueuedAttempt) {
          button.disabled = true;
          button.textContent = 'Recovery review required';
          document.getElementById('reloadWorldState')?.removeAttribute('hidden');
          return;
        }
        if (status.state === 'failed' && belongsToQueuedAttempt) {
          button.disabled = false;
          button.textContent = 'Retry failed turn';
          document.getElementById('reloadWorldState')?.removeAttribute('hidden');
          return;
        }
        if (status.state === 'complete' && belongsToQueuedAttempt && (sawProcessing || status.run?.status === 'complete')) {
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
        if (transientErrors >= 6) {
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
    if (output) output.textContent = 'Checking the current failed checkpoint before queueing recovery…';

    try {
      if (!authorization) throw new Error('Portal session is not ready');
      let baseline = { unavailable: true, run: null, operation_id: null, checksum: null };
      let preflightWarning = '';
      try {
        baseline = { ...(await statusRequest()), unavailable: false };
        if (baseline.state === 'reconciliation_required') {
          button.textContent = 'Recovery review required';
          if (output) output.textContent = statusText(baseline);
          if (reload) reload.hidden = false;
          return;
        }
      } catch (error) {
        if (!isRetriableStatusFailure(error)) throw error;
        preflightWarning = ` Status preflight was unavailable (${error.message}), so server-side replay protection will remain authoritative.`;
      }

      const response = await fetch('/api/run-due-turn-now-background', {
        method: 'POST',
        headers: { authorization, 'content-type': 'application/json' },
        body: '{}'
      });
      if (response.status !== 202 && !response.ok) {
        const text = await response.text();
        throw new Error(`Background turn could not be queued (HTTP ${response.status}${text ? ` · ${text.slice(0, 300)}` : ''})`);
      }
      const queuedServerAt = Date.parse(response.headers.get('date') || '') || null;
      button.textContent = 'Turn queued';
      if (output) output.textContent = `Production turn queued.${preflightWarning} This page will check the canonical run ledger every ten seconds; no long browser connection is being held open.`;
      await pollUntilSettled(output, button, baseline, queuedServerAt);
    } catch (error) {
      if (output) output.textContent = error.message;
      button.disabled = false;
      if (reload) reload.hidden = false;
    }
  }, true);
})();
