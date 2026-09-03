const SUPABASE_URL = window.TBG_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = window.TBG_SUPABASE_ANON_KEY || '';

function callbackParam(name) {
  const query = new URLSearchParams(window.location.search);
  if (query.has(name)) return query.get(name);
  const hash = new URLSearchParams(String(window.location.hash || '').replace(/^#/, ''));
  return hash.get(name);
}

function callbackError() {
  return callbackParam('error_description') || callbackParam('error');
}

function callbackType() {
  return callbackParam('type');
}

function callbackCode() {
  return callbackParam('code');
}

function restoredPath() {
  const saved = sessionStorage.getItem('tbg_auth_return_to');
  sessionStorage.removeItem('tbg_auth_return_to');
  if (saved && saved.startsWith('/')) return saved;
  return `${window.location.pathname}${window.location.search}`.replace(/[?&](code|type|error|error_description)=[^&#]*/g, '').replace(/[?&]$/, '') || '/';
}

async function authClient() {
  if (window.tbgAuthClient) return window.tbgAuthClient;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    const response = await fetch('/api/auth-config', { cache: 'no-store' });
    const config = await response.json();
    if (!response.ok || !config.configured) throw new Error(config.error || 'Supabase is not configured');
    window.TBG_SUPABASE_URL = config.supabase_url;
    window.TBG_SUPABASE_ANON_KEY = config.supabase_anon_key;
  }
  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
  window.tbgAuthClient = createClient(window.TBG_SUPABASE_URL, window.TBG_SUPABASE_ANON_KEY, {
    auth: {
      flowType: 'pkce',
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false
    }
  });
  return window.tbgAuthClient;
}

async function completeAuthCallback() {
  const message = callbackError();
  if (message) throw new Error(message);
  const code = callbackCode();
  if (!code) return false;
  const client = await authClient();
  const { data, error } = await client.auth.exchangeCodeForSession(code);
  if (error) throw error;
  if (!data.session?.access_token) {
    throw new Error("Supabase returned from the sign-in link, but no browser session was saved.");
  }

  sessionStorage.removeItem("tbg_auth_callback_error");
  history.replaceState({}, document.title, restoredPath());
  return true;
}

try {
  await completeAuthCallback();
} catch (error) {
  const message = error?.message || "Could not complete sign-in.";
  sessionStorage.setItem("tbg_auth_callback_error", message);
  console.error("TBG authentication callback failed:", error);
}

await import("./app.js");
await import("./club-claiming.js");
await import("./alpha-feedback.js");
await import("./alpha-updates.js");