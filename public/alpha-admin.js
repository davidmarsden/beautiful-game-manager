import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const $ = (id) => document.getElementById(id);
let session;
let context;

function text(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
}

async function authSession() {
  const configResponse = await fetch('/api/auth-config', { cache: 'no-store' });
  const config = await configResponse.json();
  if (!configResponse.ok || !config.configured) throw new Error(config.error || 'Supabase is not configured');
  const supabase = createClient(config.supabase_url, config.supabase_anon_key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
  });
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!data.session?.access_token) throw new Error('Sign in through the Manager Portal first');
  return data.session;
}

async function api(options = {}) {
  const response = await fetch('/api/alpha-admin', {
    ...options,
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers || {}),
      authorization: `Bearer ${session.access_token}`
    }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(body.error || `Request failed (${response.status})`), { body });
  return body;
}

function vacantOptions(exceptClubId = null) {
  return (context?.clubs || [])
    .filter((club) => club.vacant || club.club_id === exceptClubId)
    .map((club) => `<option value="${text(club.club_id)}">${text(club.club_name)}${club.division_id ? ` · ${text(club.division_id.replace('division-', 'D'))}` : ''}</option>`)
    .join('');
}

function renderInvites() {
  const rows = context.invites || [];
  $('inviteList').innerHTML = rows.length ? rows.map((invite) => {
    const allowed = invite.allowed_club_ids?.length ? `${invite.allowed_club_ids.length} specified club${invite.allowed_club_ids.length === 1 ? '' : 's'}` : 'Any vacant club';
    return `<article class="alpha-row"><strong>${text(invite.email)}</strong><small>${text(invite.status)} · ${text(allowed)}${invite.claimed_club_id ? ` · claimed ${text(invite.claimed_club_id)}` : ''}</small></article>`;
  }).join('') : '<p class="muted">No alpha invitations yet.</p>';
}

function renderAppointments() {
  const rows = context.appointments || [];
  $('appointmentList').innerHTML = rows.length ? rows.map((appointment) => `
    <article class="alpha-row" data-appointment="${text(appointment.appointment_id)}">
      <strong>${text(appointment.manager_name)} — ${text(appointment.club_name)}</strong>
      <small>${text(appointment.manager_email || '')} · appointed ${new Date(appointment.appointed_at).toLocaleString()}</small>
      <div class="alpha-actions">
        <select class="reassign-club" aria-label="New club"><option value="">Reassign to…</option>${vacantOptions(appointment.club_id)}</select>
        <button type="button" class="reassign-button">Reassign</button>
        <button type="button" class="end-button danger">End appointment</button>
      </div>
    </article>`).join('') : '<p class="muted">No active human appointments.</p>';

  document.querySelectorAll('.reassign-button').forEach((button) => button.addEventListener('click', async () => {
    const row = button.closest('[data-appointment]');
    const clubId = row.querySelector('.reassign-club').value;
    if (!clubId) return;
    if (!confirm('Reassign this manager to the selected club? The existing appointment will be ended and preserved in history.')) return;
    await mutate({ action: 'reassign', appointment_id: row.dataset.appointment, club_id: clubId, reason: 'Controlled alpha admin reassignment' });
  }));

  document.querySelectorAll('.end-button').forEach((button) => button.addEventListener('click', async () => {
    const row = button.closest('[data-appointment]');
    if (!confirm('End this active appointment and make the manager eligible to claim again?')) return;
    await mutate({ action: 'end', appointment_id: row.dataset.appointment, reason: 'Controlled alpha admin recovery' });
  }));
}

function render() {
  $('inviteClubs').innerHTML = (context.clubs || []).filter((club) => club.vacant).map((club) => `<option value="${text(club.club_id)}">${text(club.club_name)}${club.division_id ? ` · ${text(club.division_id.replace('division-', 'D'))}` : ''}</option>`).join('');
  renderInvites();
  renderAppointments();
  $('adminContent').hidden = false;
  $('adminStatus').textContent = 'Admin access confirmed.';
}

async function load() {
  session = await authSession();
  context = await api();
  render();
}

async function mutate(payload) {
  $('adminStatus').textContent = 'Saving…';
  try {
    await api({ method: 'POST', body: JSON.stringify(payload) });
    context = await api();
    render();
    $('adminStatus').textContent = 'Saved.';
  } catch (error) {
    $('adminStatus').textContent = error.message;
  }
}

$('inviteForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const selected = [...$('inviteClubs').selectedOptions].map((option) => option.value);
  $('inviteStatus').textContent = 'Saving invitation…';
  try {
    await api({ method: 'POST', body: JSON.stringify({ action: 'invite', email: $('inviteEmail').value, allowed_club_ids: selected }) });
    $('inviteEmail').value = '';
    [...$('inviteClubs').options].forEach((option) => { option.selected = false; });
    context = await api();
    render();
    $('inviteStatus').textContent = 'Invitation saved.';
  } catch (error) {
    $('inviteStatus').textContent = error.message;
  }
});

load().catch((error) => {
  $('adminStatus').textContent = error.message;
});
