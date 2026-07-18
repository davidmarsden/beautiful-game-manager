import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const $ = (id) => document.getElementById(id);
let client;
let currentSession;
let latestState;
let countdownTimer;
let teamFormObserver;
let applyingSubmission = false;

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

function reorderSelector(containerId, zone, orderedIds) {
  const container = $(containerId);
  if (!container) return [];
  const labels = [...container.querySelectorAll('.player-pick')];
  const idForLabel = (label) => String(label.querySelector(`input[data-zone="${zone}"]`)?.value ?? '');
  const byPlayerId = new Map(labels.map((label) => [idForLabel(label), label]));
  const selected = new Set(orderedIds);

  labels.forEach((label) => {
    const input = label.querySelector(`input[data-zone="${zone}"]`);
    if (input) input.checked = selected.has(String(input.value));
  });

  const desiredOrder = [
    ...orderedIds.filter((playerId) => byPlayerId.has(playerId)),
    ...labels.map(idForLabel).filter((playerId) => !selected.has(playerId))
  ];
  const currentOrder = labels.map(idForLabel);
  const orderChanged = desiredOrder.length !== currentOrder.length
    || desiredOrder.some((playerId, index) => playerId !== currentOrder[index]);

  if (orderChanged) {
    desiredOrder.forEach((playerId) => {
      const label = byPlayerId.get(playerId);
      if (label) container.appendChild(label);
    });
  }

  return [...container.querySelectorAll(`input[data-zone="${zone}"]`)];
}

function applySubmissionToRenderedForm(submission) {
  if (!submission || applyingSubmission) return false;
  const xiInputs = [...document.querySelectorAll('input[data-zone="xi"]')];
  const benchInputs = [...document.querySelectorAll('input[data-zone="bench"]')];
  if (!xiInputs.length || !benchInputs.length) return false;

  applyingSubmission = true;
  try {
    const orderedXi = (submission.starting_xi || []).map(String);
    const orderedBench = (submission.bench || []).map(String);
    const restoredXiInputs = reorderSelector('startingXi', 'xi', orderedXi);
    reorderSelector('bench', 'bench', orderedBench);
    restoredXiInputs[0]?.dispatchEvent(new Event('change', { bubbles: true }));
    if (submission.captain_id) $('captain').value = String(submission.captain_id);
    return true;
  } finally {
    applyingSubmission = false;
  }
}

function stopSubmissionProtection() {
  teamFormObserver?.disconnect();
  teamFormObserver = null;
}

function observeTeamForm(submission) {
  stopSubmissionProtection();
  const startingXi = $('startingXi');
  const bench = $('bench');
  if (!startingXi || !bench || !submission) return;

  const reapply = () => queueMicrotask(() => applySubmissionToRenderedForm(submission));
  teamFormObserver = new MutationObserver(reapply);
  teamFormObserver.observe(startingXi, { childList: true, subtree: true });
  teamFormObserver.observe(bench, { childList: true, subtree: true });

  let attempts = 0;
  const retry = () => {
    if (applySubmissionToRenderedForm(submission)) return;
    attempts += 1;
    if (attempts < 80) setTimeout(retry, 100);
  };
  retry();
}

// Explicit preset/previous-team loads are manager actions, not startup churn.
// Release the current-submission guard before those handlers mutate the board.
document.addEventListener('click', (event) => {
  if (event.target?.closest('#loadPreset, #loadPreviousMatch')) stopSubmissionProtection();
}, true);
document.addEventListener('tbg:team-sheet-override', stopSubmissionProtection);

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

  observeTeamForm(submission);
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