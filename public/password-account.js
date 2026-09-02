import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const button = document.getElementById('passwordButton');
const dialog = document.getElementById('passwordDialog');
const form = document.getElementById('passwordForm');
const closeButton = document.getElementById('passwordClose');
const passwordInput = document.getElementById('newPassword');
const confirmInput = document.getElementById('confirmPassword');
const status = document.getElementById('passwordStatus');

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
          autoRefreshToken: true,
          detectSessionInUrl: false
        }
      });
    })();
  }
  return clientPromise;
}

function setStatus(message, className = '') {
  if (!status) return;
  status.className = className;
  status.textContent = message;
}

button?.addEventListener('click', () => {
  passwordInput.value = '';
  confirmInput.value = '';
  setStatus('');
  dialog?.showModal();
  passwordInput?.focus();
});

closeButton?.addEventListener('click', () => dialog?.close());

dialog?.addEventListener('click', (event) => {
  if (event.target === dialog) dialog.close();
});

form?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const password = passwordInput?.value || '';
  const confirmation = confirmInput?.value || '';

  if (password.length < 8) {
    setStatus('Use at least 8 characters.', 'error');
    return;
  }
  if (password !== confirmation) {
    setStatus('Those passwords do not match.', 'error');
    return;
  }

  setStatus('Saving password…');
  try {
    const supabase = await getClient();
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) throw sessionError;
    if (!sessionData.session) throw new Error('Your session has expired. Sign in again before setting a password.');

    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw error;
    passwordInput.value = '';
    confirmInput.value = '';
    setStatus('Password saved. You can now use it to sign in on another computer.', 'ok');
  } catch (error) {
    setStatus(error?.message || 'Could not save password', 'error');
  }
});
