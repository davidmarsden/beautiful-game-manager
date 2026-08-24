import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

let supabase;

async function accessToken() {
  const bridged = String(window.tbgPortalAuthorization || '');
  if (bridged.toLowerCase().startsWith('bearer ')) return bridged.slice(7).trim();
  if (!supabase) {
    const response = await fetch('/api/auth-config', { cache: 'no-store' });
    const config = await response.json();
    if (!response.ok || !config.configured) throw new Error(config.error || 'Supabase is not configured');
    supabase = createClient(config.supabase_url, config.supabase_anon_key, {
      auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
    });
  }
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!data.session?.access_token) throw new Error('Sign in before sending feedback');
  return data.session.access_token;
}

function currentPageArea() {
  const active = document.querySelector('.tabs button.active')?.textContent?.trim();
  return active || document.title || window.location.pathname;
}

function clientContext() {
  return {
    path: `${window.location.pathname}${window.location.search}`,
    page_area: currentPageArea(),
    user_agent: navigator.userAgent,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    language: navigator.language,
    local_time: new Date().toISOString()
  };
}

async function submit(payload) {
  const token = await accessToken();
  let response = await fetch('/api/alpha-feedback', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(payload)
  });
  if (response.status === 401 && supabase) {
    const { data } = await supabase.auth.getSession();
    if (data.session?.access_token && data.session.access_token !== token) {
      response = await fetch('/api/alpha-feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${data.session.access_token}` },
        body: JSON.stringify(payload)
      });
    }
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Could not save feedback (${response.status})`);
  return body;
}

function mount() {
  if (document.getElementById('alphaFeedbackButton')) return;
  const topbar = document.querySelector('.topbar');
  const logout = document.getElementById('logoutButton');
  if (!topbar || !logout) return;

  const button = document.createElement('button');
  button.id = 'alphaFeedbackButton';
  button.className = 'alpha-feedback-button';
  button.type = 'button';
  button.textContent = 'Report / feedback';
  logout.before(button);

  const dialog = document.createElement('dialog');
  dialog.id = 'alphaFeedbackDialog';
  dialog.className = 'alpha-feedback-dialog';
  dialog.innerHTML = `
    <form method="dialog" class="alpha-feedback-card" id="alphaFeedbackForm">
      <div class="alpha-feedback-head"><div><small>CONTROLLED ALPHA</small><h2>Report something</h2></div><button class="alpha-feedback-close" type="button" aria-label="Close">×</button></div>
      <p class="alpha-feedback-help">Send this straight from the game — no GitHub account needed. Please don't include passwords, magic links or other secrets.</p>
      <div class="alpha-feedback-grid">
        <label>Type<select name="kind"><option value="bug">Bug</option><option value="feedback">Feedback</option></select></label>
        <label>Category<select name="category"><option value="broken">Something is broken</option><option value="confusing">Confusing</option><option value="presentation">Presentation / UI</option><option value="performance">Slow / performance</option><option value="feature_request">Feature request</option><option value="other">Other</option></select></label>
      </div>
      <label>Page / area<input name="page_area" maxlength="500"></label>
      <label>What were you doing?<textarea name="action_taken" maxlength="4000"></textarea></label>
      <div class="alpha-feedback-grid">
        <label>What did you expect?<textarea name="expected_result" maxlength="4000"></textarea></label>
        <label>What happened instead?<textarea name="actual_result" maxlength="4000"></textarea></label>
      </div>
      <label>Anything else?<textarea name="note" maxlength="6000" placeholder="For general feedback, this can be the only field you fill in."></textarea></label>
      <p class="alpha-feedback-help">Your manager, club, route, browser/device details and submission time are attached automatically. Screenshot upload can follow later; for now mention anything visible that may help reproduce it.</p>
      <div class="alpha-feedback-actions"><button class="submit" type="submit">Send report</button><p id="alphaFeedbackStatus" class="alpha-feedback-status" aria-live="polite"></p></div>
    </form>`;
  document.body.append(dialog);

  const form = dialog.querySelector('#alphaFeedbackForm');
  const status = dialog.querySelector('#alphaFeedbackStatus');
  const close = dialog.querySelector('.alpha-feedback-close');
  button.addEventListener('click', () => {
    form.elements.page_area.value = currentPageArea();
    status.textContent = '';
    dialog.showModal();
  });
  close.addEventListener('click', () => dialog.close());
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submitButton = form.querySelector('[type="submit"]');
    submitButton.disabled = true;
    status.textContent = 'Sending…';
    try {
      const values = Object.fromEntries(new FormData(form));
      const result = await submit({ ...values, client_context: clientContext() });
      status.textContent = `Saved. Reference ${result.report_id.slice(0, 8)}.`;
      const kind = form.elements.kind.value;
      const category = form.elements.category.value;
      form.reset();
      form.elements.kind.value = kind;
      form.elements.category.value = category;
      form.elements.page_area.value = currentPageArea();
    } catch (error) {
      status.textContent = error.message;
    } finally {
      submitButton.disabled = false;
    }
  });
}

mount();
