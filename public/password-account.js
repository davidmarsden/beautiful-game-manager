import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const button = document.getElementById('passwordButton');
const dialog = document.getElementById('passwordDialog');
const form = document.getElementById('passwordForm');
const closeButton = document.getElementById('passwordClose');
const passwordInput = document.getElementById('newPassword');
const confirmInput = document.getElementById('confirmPassword');
const status = document.getElementById('passwordStatus');
const authHelp = document.querySelector('.auth-help');
const onboardingIntro = document.querySelector('#onboardingState > p');
const passwordIntro = document.querySelector('#passwordForm > p');

if (authHelp) {
  authHelp.innerHTML = '<strong>First time here?</strong> Use the email link to sign in. That does not create a password. Once you are inside the Manager Portal, choose <strong>Password</strong> at the top, set one, and then use email + password for future sign-ins.';
}
if (onboardingIntro) {
  onboardingIntro.textContent = 'Complete your manager profile, then choose Password at the top of the portal and save a password for future sign-ins.';
}
if (passwordIntro) {
  passwordIntro.textContent = 'Set a password here after your first email-link sign-in. Saving it is what enables email + password sign-in on this or another computer.';
}

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
    setStatus('Password saved. You can now sign in directly with your email and this password.', 'ok');
  } catch (error) {
    setStatus(error?.message || 'Could not save password', 'error');
  }
});
