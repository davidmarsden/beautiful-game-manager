(() => {
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[char]));

  function clear() {
    document.getElementById('portalBootRecovery')?.remove();
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

  function showLoading() {
    if (document.getElementById('portalBootRecovery')) return;
    document.body.insertAdjacentHTML('beforeend', `
      <section id="portalBootRecovery" data-recovery-source="boot_loading" role="status" aria-live="polite" style="position:fixed;inset:0;z-index:2147483647;background:#f7f3ea;color:#1f1f1f;display:grid;place-items:center;padding:24px;font-family:system-ui,sans-serif;">
        <div style="width:min(520px,100%);background:#fff;border:1px solid #d8d0c0;border-radius:14px;padding:24px;box-shadow:0 18px 60px rgba(0,0,0,.18);">
          <p style="margin:0 0 8px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;">The Beautiful Game</p>
          <h1 style="margin:0 0 12px;font-size:1.6rem;">Loading manager portal…</h1>
          <p style="margin:0;line-height:1.5;">Fetching your club and the current canonical turn. This can take a little longer after a fresh deployment.</p>
        </div>
      </section>`);
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
    const dismissibleSource = ['boot_loading', 'boot_watchdog'].includes(recovery?.dataset.recoverySource);
    if (usablePortalScreen() && (!recovery || dismissibleSource)) clear();
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
    if (!usablePortalScreen() && !document.querySelector('#portal .fatal-error')) showLoading();
  });

  window.setTimeout(() => {
    inspectPortal();
    const recovery = document.getElementById('portalBootRecovery');
    const fatal = document.querySelector('#portal .fatal-error');
    const waitingOnly = !recovery || recovery.dataset.recoverySource === 'boot_loading';
    if (!usablePortalScreen() && waitingOnly && !fatal?.textContent?.trim()) {
      show('The manager portal has not produced a sign-in, club, onboarding or unassigned screen within 30 seconds. Bootstrap may still be pending or may have failed.', 'boot_watchdog');
    }
  }, 30000);
})();
