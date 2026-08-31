(() => {
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[char]));

  const startupStartedAt = performance.now();
  const trackedRequests = [];
  const pendingRequests = new Map();
  let requestSequence = 0;
  let portalRenderedAt = null;
  let loadingTicker = null;

  const originalFetch = window.fetch.bind(window);

  function requestStage(input, init = {}) {
    const requestUrl = typeof input === 'string' ? input : input?.url;
    if (!requestUrl) return '';
    let url;
    try {
      url = new URL(requestUrl, window.location.href);
    } catch {
      return '';
    }

    if (url.origin === window.location.origin && url.pathname === '/api/auth-config') return 'auth_config';
    if (url.origin === window.location.origin && url.pathname === '/api/bootstrap') return 'bootstrap';
    if (url.pathname.endsWith('/auth/v1/user')) return 'auth_user';
    if (url.pathname.endsWith('/auth/v1/token')) {
      const grantType = url.searchParams.get('grant_type');
      if (grantType === 'refresh_token') return 'session_refresh';
      return 'sign_in_exchange';
    }
    return '';
  }

  function stageLabel(stage) {
    return ({
      auth_config: 'Connecting to TBG services',
      sign_in_exchange: 'Completing secure sign-in',
      session_refresh: 'Restoring secure session',
      auth_user: 'Checking manager session',
      bootstrap: 'Loading club and world'
    })[stage] || 'Preparing manager portal';
  }

  function snapshot() {
    const now = performance.now();
    return {
      elapsed_ms: Math.round((portalRenderedAt ?? now) - startupStartedAt),
      rendered: portalRenderedAt !== null,
      pending: [...pendingRequests.values()].map((entry) => ({
        stage: entry.stage,
        elapsed_ms: Math.round(now - entry.startedAt)
      })),
      requests: trackedRequests.map(({ stage, durationMs, status, ok }) => ({
        stage,
        duration_ms: Math.round(durationMs),
        status,
        ok
      }))
    };
  }

  function persistSnapshot() {
    const data = snapshot();
    try {
      sessionStorage.setItem('tbg_portal_startup_timing', JSON.stringify(data));
    } catch {}
    return data;
  }

  window.tbgPortalStartupTiming = Object.freeze({ snapshot });

  window.fetch = async (...args) => {
    const stage = requestStage(args[0], args[1] || {});
    if (!stage) return originalFetch(...args);

    const id = ++requestSequence;
    const startedAt = performance.now();
    pendingRequests.set(id, { id, stage, startedAt });
    refreshLoadingCopy();

    try {
      const response = await originalFetch(...args);
      trackedRequests.push({
        stage,
        durationMs: performance.now() - startedAt,
        status: response.status,
        ok: response.ok
      });
      return response;
    } catch (error) {
      trackedRequests.push({
        stage,
        durationMs: performance.now() - startedAt,
        status: 0,
        ok: false
      });
      throw error;
    } finally {
      pendingRequests.delete(id);
      persistSnapshot();
      refreshLoadingCopy();
    }
  };

  function clear() {
    document.getElementById('portalBootRecovery')?.remove();
    if (loadingTicker) {
      clearInterval(loadingTicker);
      loadingTicker = null;
    }
  }

  function show(message, source = 'portal_boot') {
    const existing = document.getElementById('portalBootRecovery');
    const detail = String(message || 'The manager portal could not finish loading.').trim();
    const html = `
      <section id="portalBootRecovery" data-recovery-source="${escapeHtml(source)}" role="alert" style="position:fixed;inset:0;z-index:2147483647;background:#f7f3ea;color:#1f1f1f;display:grid;place-items:center;padding:24px;font-family:system-ui,sans-serif;">
        <div style="width:min(680px,100%);background:#fff;border:1px solid #d8d0c0;border-radius:14px;padding:24px;box-shadow:0 18px 60px rgba(0,0,0,.18);">
          <p style="margin:0 0 8px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;">The Beautiful Game</p>
          <h1 style="margin:0 0 12px;font-size:1.6rem;">Portal recovery</h1>
          <p style="margin:0 0 16px;line-height:1.5;">The portal hit an error while loading. Your canonical world has not been changed by this screen.</p>
          <pre style="white-space:pre-wrap;overflow-wrap:anywhere;background:#f4f1ea;padding:12px;border-radius:8px;max-height:240px;overflow:auto;">${escapeHtml(detail)}</pre>
          <small style="display:block;margin:8px 0 18px;opacity:.7;">Source: ${escapeHtml(source)}</small>
          <div style="display:flex;flex-wrap:wrap;gap:10px;">
            <button id="portalRecoveryRetry" type="button" style="padding:10px 14px;">Retry portal</button>
            <button id="portalRecoveryWorld" type="button" style="padding:10px 14px;">Open World</button>
            <button id="portalRecoverySignOut" type="button" style="padding:10px 14px;">Clear session and sign out</button>
          </div>
        </div>
      </section>`;

    if (existing) existing.outerHTML = html;
    else document.body.insertAdjacentHTML('beforeend', html);

    document.getElementById('portalRecoveryRetry')?.addEventListener('click', () => window.location.reload());
    document.getElementById('portalRecoveryWorld')?.addEventListener('click', () => {
      const url = new URL(window.location.href);
      url.searchParams.set('view', 'world');
      window.location.assign(url.toString());
    });
    document.getElementById('portalRecoverySignOut')?.addEventListener('click', () => {
      try {
        Object.keys(localStorage).filter((key) => key.startsWith('sb-') || key.startsWith('tbg_')).forEach((key) => localStorage.removeItem(key));
        sessionStorage.clear();
      } catch {}
      window.location.assign('/');
    });
  }

  function loadingDiagnostics() {
    const timing = snapshot();
    const pending = timing.pending[0];
    if (pending) return `${stageLabel(pending.stage)} · ${Math.max(1, Math.round(pending.elapsed_ms / 1000))}s`;
    const completed = timing.requests.slice(-3).map((entry) => `${stageLabel(entry.stage)} ${Math.max(0.1, entry.duration_ms / 1000).toFixed(1)}s`);
    return completed.join(' · ');
  }

  function refreshLoadingCopy() {
    const recovery = document.getElementById('portalBootRecovery');
    if (!recovery || recovery.dataset.recoverySource !== 'boot_loading') return;

    const elapsedSeconds = Math.max(0, Math.round((performance.now() - startupStartedAt) / 1000));
    const pending = snapshot().pending[0];
    const heading = recovery.querySelector('[data-boot-heading]');
    const message = recovery.querySelector('[data-boot-message]');
    const diagnostics = recovery.querySelector('[data-boot-diagnostics]');

    if (heading && elapsedSeconds >= 5) heading.textContent = `${stageLabel(pending?.stage)}…`;
    if (message) {
      message.textContent = elapsedSeconds >= 15
        ? 'This is taking longer than usual. TBG is still waiting for a secure response; please leave this page open.'
        : 'Loading your club and the current world state.';
    }
    if (diagnostics) {
      const detail = loadingDiagnostics();
      diagnostics.textContent = elapsedSeconds >= 5 && detail ? `${detail} · ${elapsedSeconds}s total` : '';
      diagnostics.hidden = !diagnostics.textContent;
    }
  }

  function showLoading() {
    if (document.getElementById('portalBootRecovery')) return;
    document.body.insertAdjacentHTML('beforeend', `
      <section id="portalBootRecovery" data-recovery-source="boot_loading" role="status" aria-live="polite" style="position:fixed;inset:0;z-index:2147483647;background:#f7f3ea;color:#1f1f1f;display:grid;place-items:center;padding:24px;font-family:system-ui,sans-serif;">
        <div style="width:min(520px,100%);background:#fff;border:1px solid #d8d0c0;border-radius:14px;padding:24px;box-shadow:0 18px 60px rgba(0,0,0,.18);">
          <p style="margin:0 0 8px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;">The Beautiful Game</p>
          <h1 data-boot-heading style="margin:0 0 12px;font-size:1.6rem;">Loading manager portal…</h1>
          <p data-boot-message style="margin:0;line-height:1.5;">Loading your club and the current world state.</p>
          <small data-boot-diagnostics hidden style="display:block;margin-top:12px;opacity:.68;line-height:1.45;"></small>
        </div>
      </section>`);
    refreshLoadingCopy();
    if (!loadingTicker) loadingTicker = setInterval(refreshLoadingCopy, 1000);
  }

  function visible(element) {
    return Boolean(element && !element.hidden && getComputedStyle(element).display !== 'none' && getComputedStyle(element).visibility !== 'hidden');
  }

  function usablePortalScreen() {
    return [
      document.getElementById('authGate'),
      document.getElementById('clubPortal'),
      document.getElementById('unassignedState'),
      document.getElementById('onboardingState')
    ].some(visible);
  }

  function inspectPortal() {
    const fatal = document.querySelector('#portal .fatal-error');
    if (fatal?.textContent?.trim()) {
      show(fatal.textContent.trim(), 'bootstrap_error');
      return;
    }
    const recovery = document.getElementById('portalBootRecovery');
    if (usablePortalScreen()) {
      if (!recovery || recovery.dataset.recoverySource === 'boot_loading') clear();
      return;
    }
    if (!recovery) showLoading();
    refreshLoadingCopy();
  }

  window.tbgShowPortalRecovery = show;
  window.tbgDismissPortalRecovery = clear;

  window.addEventListener('error', (event) => {
    const message = event.error?.stack || event.error?.message || event.message;
    if (message) show(message, 'window_error');
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    show(reason?.stack || reason?.message || reason, 'unhandled_rejection');
  });

  window.addEventListener('tbg:portal-rendered', () => {
    if (portalRenderedAt === null) {
      portalRenderedAt = performance.now();
      const data = persistSnapshot();
      console.info('TBG portal startup timing', data);
    }
    inspectPortal();
  });

  window.addEventListener('DOMContentLoaded', () => {
    if (document.body) {
      new MutationObserver(inspectPortal).observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['hidden', 'class', 'style']
      });
    }
    inspectPortal();
  });

  window.setTimeout(() => {
    inspectPortal();
    refreshLoadingCopy();
  }, 30000);
})();
