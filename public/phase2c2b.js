import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const $ = (id) => document.getElementById(id);
let client;
let currentSession;
let latestState;
let countdownTimer;

async function config() {
  const response = await fetch('/api/auth-config', { cache: 'no-store' });
  const body = await response.json();
  if (!response.ok || !body.configured) throw new Error(body.error || 'Supabase is not configured');
  return body;
}

async function session() {
  if (!client) {
    const cfg = await config();
    client = createClient(cfg.supabase_url, cfg.supabase_anon_key, { auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
  }
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  currentSession = data.session;
  return currentSession;
}

async function bootstrap() {
  const active = await session();
  if (!active) return null;
  const response = await fetch('/api/bootstrap', { headers: { authorization: `Bearer ${active.access_token}` }, cache: 'no-store' });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Could not load manager state');
  latestState = body;
  return body;
}

function showOnboarding(state) {
  const onboarding = $('onboardingState');
  if (!onboarding) return;
  onboarding.hidden = !state?.onboarding_required;
  if (state?.onboarding_required) {
    $('clubPortal').hidden = true;
    $('unassignedState').hidden = true;
    $('onboardingName').value = state.manager?.display_name || '';
    $('onboardingCountry').value = state.manager?.country || '';
    $('onboardingTimezone').value = state.manager?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/London';
    $('onboardingFavouriteClub').value = state.manager?.favourite_club || '';
  }
}

function renderInboxMeta(state) {
  const badge = $('inboxBadge');
  if (!badge) return;
  const count = Number(state?.unread_count || 0);
  badge.textContent = count;
  badge.hidden = count < 1;
  badge.title = `${count} unread message${count === 1 ? '' : 's'}`;
}

function deadlineLabel(deadline) {
  if (!deadline) return '';
  const remaining = new Date(deadline).getTime() - Date.now();
  if (remaining <= 0) return 'Deadline passed · team locked';
  const totalMinutes = Math.floor(remaining / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  return `${days ? `${days}d ` : ''}${hours ? `${hours}h ` : ''}${minutes}m remaining`;
}

function renderDeadline(state) {
  clearInterval(countdownTimer);
  const target = $('deadlineCountdown');
  const submit = $('decisionForm')?.querySelector('button[type="submit"]');
  const fixture = state?.next_fixture;
  if (!target) return;
  const update = () => {
    target.textContent = deadlineLabel(fixture?.submission_deadline_at);
    const locked = !fixture || fixture.locked || (fixture.submission_deadline_at && Date.now() >= new Date(fixture.submission_deadline_at).getTime());
    if (submit) {
      submit.disabled = locked;
      submit.textContent = locked ? 'Team locked' : (state?.current_submission ? 'Save changes' : 'Save team and tactics');
    }
  };
  update();
  countdownTimer = setInterval(update, 60000);
}

function applySubmissionToRenderedForm(submission, attempt = 0) {
  const xiInputs = [...document.querySelectorAll('input[data-zone="xi"]')];
  const benchInputs = [...document.querySelectorAll('input[data-zone="bench"]')];

  // app.js builds these controls asynchronously after its own bootstrap call.
  // Do not apply the saved submission until both lists actually exist.
  if ((!xiInputs.length || !benchInputs.length) && attempt < 40) {
    setTimeout(() => applySubmissionToRenderedForm(submission, attempt + 1), 150);
    return;
  }
  if (!xiInputs.length || !benchInputs.length) return;

  const xi = new Set(submission.starting_xi || []);
  const bench = new Set(submission.bench || []);
  xiInputs.forEach((input) => { input.checked = xi.has(input.value); });
  benchInputs.forEach((input) => { input.checked = bench.has(input.value); });

  // Rebuild the captain list from the restored XI, then restore the captain.
  xiInputs[0]?.dispatchEvent(new Event('change'));
  if (submission.captain_id) $('captain').value = submission.captain_id;
}

function renderSubmission(state) {
  const submission = state?.current_submission;
  const summary = $('submissionSummary');
  const panel = $('currentSubmissionPanel');
  if (summary) summary.textContent = submission ? `Submitted · version ${submission.version}` : 'No team submitted';
  if (!panel) return;
  panel.hidden = !submission;
  if (!submission) return;
  panel.innerHTML = `<strong>Current submission</strong><span>Version ${submission.version}</span><span>${submission.formation}</span><span>${new Date(submission.updated_at || submission.submitted_at).toLocaleString()}</span><span class="badge ${submission.status === 'locked' ? 'injured' : 'fit'}">${submission.status}</span>`;

  $('formation').value = submission.formation || $('formation').value;
  const tactics = submission.tactics || {};
  if (tactics.mentality) $('mentality').value = tactics.mentality;
  if (tactics.pressing) $('pressing').value = tactics.pressing;
  if (tactics.tempo) $('tempo').value = tactics.tempo;
  if (tactics.width) $('width').value = tactics.width;
  if (tactics.defensive_line) $('defensiveLine').value = tactics.defensive_line;

  applySubmissionToRenderedForm(submission);
}

async function refreshEnhancements() {
  const state = await bootstrap();
  if (!state) return;
  showOnboarding(state);
  renderInboxMeta(state);
  renderDeadline(state);
  renderSubmission(state);
}

$('onboardingForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const status = $('onboardingStatus');
  status.className = '';
  status.textContent = 'Saving manager profile…';
  try {
    const active = await session();
    const response = await fetch('/api/profile', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${active.access_token}` },
      body: JSON.stringify({ display_name: $('onboardingName').value, country: $('onboardingCountry').value, timezone: $('onboardingTimezone').value, favourite_club: $('onboardingFavouriteClub').value })
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'Could not save profile');
    status.className = 'ok';
    status.textContent = 'Profile completed. Loading your club…';
    window.location.reload();
  } catch (error) {
    status.className = 'error';
    status.textContent = error.message;
  }
});

window.addEventListener('load', () => setTimeout(() => refreshEnhancements().catch(console.error), 500));
document.addEventListener('submit', (event) => {
  if (event.target?.id === 'decisionForm') setTimeout(() => refreshEnhancements().catch(console.error), 1200);
});
