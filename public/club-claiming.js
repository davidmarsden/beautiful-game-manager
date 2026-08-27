import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

let clientPromise;
let claimLoaded = false;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function client() {
  if (!clientPromise) clientPromise = (async () => {
    const response = await fetch('/api/auth-config', { cache: 'no-store' });
    const config = await response.json();
    if (!response.ok || !config.configured) throw new Error(config.error || 'Supabase is not configured');
    return createClient(config.supabase_url, config.supabase_anon_key, {
      auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: false, detectSessionInUrl: false }
    });
  })();
  return clientPromise;
}

async function session() {
  const supabase = await client();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    if (data.session?.access_token) return data.session;
    if (attempt < 3) await wait(150 * (attempt + 1));
  }
  return null;
}

async function authorization() {
  const bridged = String(window.tbgPortalAuthorization || '').trim();
  if (bridged.toLowerCase().startsWith('bearer ')) return bridged;
  const current = await session();
  return current?.access_token ? `Bearer ${current.access_token}` : '';
}

async function freshAuthorization() {
  const current = await session();
  const auth = current?.access_token ? `Bearer ${current.access_token}` : '';
  if (auth) window.tbgPortalAuthorization = auth;
  return auth;
}

async function api(path, options = {}) {
  const initialAuth = await authorization();
  if (!initialAuth) throw new Error('Sign in again to continue');

  const request = (auth) => fetch(path, {
    ...options,
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers || {}),
      authorization: auth
    }
  });

  let response = await request(initialAuth);
  if (response.status === 401 && String(window.tbgPortalAuthorization || '').trim() === initialAuth) {
    const refreshedAuth = await freshAuthorization();
    if (refreshedAuth && refreshedAuth !== initialAuth) response = await request(refreshedAuth);
  }

  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(body.error || `Request failed (${response.status})`), { status: response.status, body });
  return body;
}

function styles() {
  if (document.getElementById('clubClaimingStyles')) return;
  const style = document.createElement('style');
  style.id = 'clubClaimingStyles';
  style.textContent = `
    .club-claim-panel{margin-top:1.5rem;max-width:900px}.club-claim-intro{max-width:700px;color:#5c4150}
    .club-claim-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:.8rem;margin-top:1rem}
    .club-claim-card{border:1px solid rgba(126,24,75,.18);background:#fff8fb;border-radius:14px;padding:1rem;text-align:left;cursor:pointer}
    .club-claim-card:hover,.club-claim-card:focus{border-color:#b4276a;box-shadow:0 5px 18px rgba(126,24,75,.12);outline:none}
    .club-claim-card strong{display:block;font-size:1rem;color:#64143d}.club-claim-card span{display:block;margin-top:.3rem;color:#715566;font-size:.88rem}
    .club-claim-status{margin-top:1rem}.alpha-admin-link{margin-left:auto;color:inherit;font-weight:700;text-decoration:none;padding:.45rem .7rem;border:1px solid currentColor;border-radius:999px}
  `;
  document.head.append(style);
}

function panel() {
  const state = document.getElementById('unassignedState');
  if (!state) return null;
  let host = document.getElementById('clubClaimPanel');
  if (!host) {
    host = document.createElement('div');
    host.id = 'clubClaimPanel';
    host.className = 'club-claim-panel';
    state.append(host);
  }
  return host;
}

function clubMeta(club) {
  const division = club.division_id ? club.division_id.replace('division-', 'Division ') : 'Unseeded';
  const rank = club.world_rank ? ` · World rank ${club.world_rank}` : '';
  return `${division}${rank}`;
}

async function claim(club) {
  if (!confirm(`Claim ${club.club_name} as your TBG club?\n\nThis creates your active manager appointment.`)) return;
  const status = document.getElementById('clubClaimStatus');
  if (status) status.textContent = `Claiming ${club.club_name}…`;
  try {
    await api('/api/club-claim', { method: 'POST', body: JSON.stringify({ club_id: club.club_id }) });
    if (status) status.textContent = `${club.club_name} claimed. Loading your club…`;
    window.location.reload();
  } catch (error) {
    if (error.body?.code === 'club_taken') {
      if (status) status.textContent = 'Someone else claimed that club first. Refreshing the available clubs…';
      claimLoaded = false;
      setTimeout(loadClaimContext, 700);
      return;
    }
    if (status) status.textContent = error.message;
  }
}

async function loadClaimContext() {
  const state = document.getElementById('unassignedState');
  if (!state || state.hidden || claimLoaded) return;
  claimLoaded = true;
  styles();
  const host = panel();
  if (!host) return;
  host.innerHTML = '<p class="club-claim-intro">Checking your controlled-alpha invitation…</p>';
  try {
    const context = await api('/api/club-claim');
    if (context.already_appointed) {
      host.innerHTML = '<p class="club-claim-intro">Your club appointment is already active. Reloading the portal…</p>';
      setTimeout(() => window.location.reload(), 300);
      return;
    }
    if (!context.invited) {
      host.innerHTML = '<p class="club-claim-intro"><strong>This account is not on the controlled-alpha invitation list yet.</strong><br>Your manager profile is safe; an alpha administrator needs to invite this email before you can claim a club.</p>';
      return;
    }
    if (!context.profile_completed) {
      host.innerHTML = '<p class="club-claim-intro">Complete your manager profile first, then return here to choose a club.</p>';
      return;
    }
    const clubs = Array.isArray(context.clubs) ? context.clubs : [];
    if (!clubs.length) {
      host.innerHTML = '<p class="club-claim-intro"><strong>No eligible clubs are currently available.</strong><br>An administrator may need to widen your invitation or free a club.</p>';
      return;
    }
    host.innerHTML = `
      <h2>Choose your club</h2>
      <p class="club-claim-intro">These clubs are currently vacant and available under your alpha invitation. Choose carefully — this becomes your active appointment in the shared world.</p>
      <div id="clubClaimGrid" class="club-claim-grid"></div>
      <p id="clubClaimStatus" class="club-claim-status" aria-live="polite"></p>
    `;
    const grid = document.getElementById('clubClaimGrid');
    clubs.forEach((club) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'club-claim-card';
      button.innerHTML = `<strong>${club.club_name}</strong><span>${clubMeta(club)}</span>`;
      button.addEventListener('click', () => claim(club));
      grid.append(button);
    });
  } catch (error) {
    host.innerHTML = `<p class="club-claim-intro">Could not load club claiming: ${error.message}</p>`;
  }
}

async function addAdminLink() {
  try {
    const bootstrap = await api('/api/bootstrap');
    if (!bootstrap.manager?.is_admin || document.getElementById('alphaAdminLink')) return;
    const topbar = document.querySelector('.topbar');
    const logout = document.getElementById('logoutButton');
    if (!topbar || !logout) return;
    const link = document.createElement('a');
    link.id = 'alphaAdminLink';
    link.className = 'alpha-admin-link';
    link.href = '/alpha-admin.html';
    link.textContent = 'Alpha admin';
    topbar.insertBefore(link, logout);
  } catch {
    // Bootstrap may still be initializing; admin navigation is non-critical.
  }
}

const unassigned = document.getElementById('unassignedState');
if (unassigned) {
  new MutationObserver(() => {
    if (!unassigned.hidden) loadClaimContext();
  }).observe(unassigned, { attributes: true, attributeFilter: ['hidden'] });
  if (!unassigned.hidden) loadClaimContext();
}

window.addEventListener('tbg:portal-ready', addAdminLink);
setTimeout(addAdminLink, 1200);
