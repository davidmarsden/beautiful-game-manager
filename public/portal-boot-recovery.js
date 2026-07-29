(() => {
  let dismissed = false;

  const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[char]));

  function show(message, source = 'portal_boot') {
    if (dismissed) return;
    const existing = document.getElementById('portalBootRecovery');
    const detail = String(message || 'The manager portal could not finish loading.').trim();
    const html = `
      <section id="portalBootRecovery" role="alert" style="position:fixed;inset:0;z-index:2147483647;background:#f7f3ea;color:#1f1f1f;display:grid;place-items:center;padding:24px;font-family:system-ui,sans-serif;">
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

  window.tbgShowPortalRecovery = show;
  window.tbgDismissPortalRecovery = () => {
    dismissed = true;
    document.getElementById('portalBootRecovery')?.remove();
  };

  window.addEventListener('error', (event) => {
    const message = event.error?.stack || event.error?.message || event.message;
    if (message) show(message, 'window_error');
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    show(reason?.stack || reason?.message || reason, 'unhandled_rejection');
  });

  window.setTimeout(() => {
    const authVisible = !document.getElementById('authGate')?.hidden;
    const portalVisible = !document.getElementById('portal')?.hidden;
    if (!authVisible && !portalVisible) show('Neither the sign-in screen nor the manager portal became visible within 12 seconds.', 'boot_watchdog');
  }, 12000);
})();
