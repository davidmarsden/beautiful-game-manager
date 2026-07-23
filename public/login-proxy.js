const loginForm = document.getElementById('loginForm');
const loginEmail = document.getElementById('loginEmail');
const loginStatus = document.getElementById('loginStatus');

loginForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  event.stopImmediatePropagation();
  loginStatus.className = '';
  loginStatus.textContent = 'Sending secure login link…';

  try {
    const response = await fetch('/api/request-login-link', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: loginEmail.value.trim(),
        redirect_to: `${window.location.origin}/`
      })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Could not send login link');
    loginStatus.className = 'ok';
    loginStatus.textContent = 'Check your email for the TBG sign-in link.';
  } catch (error) {
    loginStatus.className = 'error';
    loginStatus.textContent = error.message || 'Could not send login link';
  }
}, true);
