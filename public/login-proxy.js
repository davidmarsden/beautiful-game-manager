import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const loginForm = document.getElementById('loginForm');
const loginEmail = document.getElementById('loginEmail');
const loginPassword = document.getElementById('loginPassword');
const loginStatus = document.getElementById('loginStatus');
const magicLinkButton = document.getElementById('magicLinkButton');

let clientPromise = null;

async function getClient() {
  if (!clientPromise) {
    clientPromise = (async () => {
      const response = await fetch('/api/auth-config', { cache: 'no-store' });
      const config = await response.json();
      if (!response.ok || !config.configured) {
        throw new Error(config.error || 'Supabase is not configured on Netlify yet.');
      }
      return createClient(config.supabase_url, config.supabase_anon_key, {
        auth: {
          flowType: 'pkce',
          persistSession: true,
          autoRefreshToken: false,
          detectSessionInUrl: false
        }
      });
    })();
  }
  return clientPromise;
}

function setStatus(message, className = '') {
  if (!loginStatus) return;
  loginStatus.className = className;
  loginStatus.textContent = message;
}

loginForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  event.stopImmediatePropagation();

  const email = loginEmail?.value.trim() || '';
  const password = loginPassword?.value || '';
  if (!email || !password) {
    setStatus('Enter your email address and password, or use the email login-link option.', 'error');
    return;
  }

  setStatus('Signing in…');
  try {
    const supabase = await getClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    setStatus('Signed in. Loading your manager portal…', 'ok');
    window.location.reload();
  } catch (error) {
    setStatus(error?.message || 'Could not sign in', 'error');
  }
}, true);

magicLinkButton?.addEventListener('click', async (event) => {
  event.preventDefault();
  event.stopImmediatePropagation();
  const email = loginEmail?.value.trim() || '';
  if (!email) {
    setStatus('Enter your registered email address first.', 'error');
    loginEmail?.focus();
    return;
  }

  setStatus('Sending secure login link…');
  try {
    const response = await fetch('/api/request-login-link', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email,
        redirect_to: `${window.location.origin}/`
      })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Could not send login link');
    setStatus('Check your email for the TBG sign-in link.', 'ok');
  } catch (error) {
    setStatus(error?.message || 'Could not send login link', 'error');
  }
}, true);
