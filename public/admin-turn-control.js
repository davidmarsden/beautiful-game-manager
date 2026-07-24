const nativeFetch = window.fetch.bind(window);
let authorization = '';

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
    </section>`);
  document.getElementById('runDueTurnNow').addEventListener('click', async () => {
    const button = document.getElementById('runDueTurnNow');
    const output = document.getElementById('runDueTurnResult');
    button.disabled = true;
    output.textContent = 'Claiming due world and running the production scheduler…';
    try {
      if (!authorization) throw new Error('Portal session is not ready');
      const response = await nativeFetch('/api/run-due-turn-now', {
        method: 'POST',
        headers: { authorization, 'content-type': 'application/json' },
        body: '{}'
      });
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
}

window.addEventListener('tbg:portal-rendered', (event) => queueMicrotask(() => mount(event.detail)));
