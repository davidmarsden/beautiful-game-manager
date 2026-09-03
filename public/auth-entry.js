import './portal-v1.js';
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const PENDING_CLUB_KEY = "tbg_pending_club_id";
const SAFE_CLUB_ID = /^[A-Za-z0-9._:-]{1,160}$/;
const ALPHA_RULEBOOK_URL = './rulebook.html';
const RATINGS_EXPLAINER_URL = './ratings.html';
const ROAD_AHEAD_URL = './road-ahead.html';
let callbackUrlCanBeCleared = false;

function addAlphaGuideLinks() {
  const gateCard = document.querySelector('#authGate .auth-card');
  if (gateCard && !gateCard.querySelector('.alpha-guide-entry-link')) {
    const guide = document.createElement('p');
    guide.className = 'alpha-guide-entry-link';
    guide.innerHTML = '<a href="./alpha-guide.html">New tester? Read the controlled-alpha guide first.</a>';
    gateCard.append(guide);
  }

  const topbar = document.querySelector('.topbar');
  const managerChip = document.getElementById('managerChip');
  if (topbar && managerChip && !topbar.querySelector('.alpha-guide-topbar-link')) {
    const guide = document.createElement('a');
    guide.className = 'manager-chip alpha-guide-topbar-link';
    guide.href = './alpha-guide.html';
    guide.textContent = 'Alpha guide';
    managerChip.before(guide);
  }
}

function addGovernanceLinks() {
  if (!document.querySelector('link[href="./governance-links.css"]')) {
    const stylesheet = document.createElement('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = './governance-links.css';
    document.head.append(stylesheet);
  }

  const shell = document.querySelector('.shell');
  if (!shell || document.getElementById('tbgGovernanceLinks')) return;

  const links = document.createElement('aside');
  links.id = 'tbgGovernanceLinks';
  links.className = 'tbg-governance-links';
  links.setAttribute('aria-label', 'Rules, ratings and development roadmap');
  links.innerHTML = `
    <strong>Rules, ratings &amp; roadmap</strong>
    <a href="${ALPHA_RULEBOOK_URL}">Alpha Rulebook — current rules</a>
    <span class="tbg-governance-separator" aria-hidden="true">·</span>
    <a href="${RATINGS_EXPLAINER_URL}">How Ratings Work — The Pink Final</a>
    <span class="tbg-governance-separator" aria-hidden="true">·</span>
    <a href="${ROAD_AHEAD_URL}">Road Ahead — planned systems</a>
  `;
  shell.prepend(links);
}

function enhanceLandingPage() {
  const gate = document.getElementById('authGate');
  const card = gate?.querySelector('.auth-card');
  if (!gate || !card || gate.querySelector('.tbg-landing')) return;

  const landing = document.createElement('div');
  landing.className = 'tbg-landing';

  const story = document.createElement('section');
  story.className = 'tbg-landing-story';
  story.setAttribute('aria-labelledby', 'tbgLandingTitle');
  story.innerHTML = `
    <p class="tbg-landing-eyebrow">The Beautiful Game</p>
    <h1 id="tbgLandingTitle">One world. Real players. Human managers.</h1>
    <p class="tbg-landing-lede">The Beautiful Game is a persistent online football management world. Build your squad, set your team and tactics, trade with other managers and live with the consequences as the shared world moves from matchday to matchday.</p>
    <ul class="tbg-landing-points" aria-label="Game features">
      <li>Persistent shared world</li>
      <li>Real-player data</li>
      <li>Transfers & contracts</li>
      <li>Tactics & matchdays</li>
      <li>Manager community</li>
    </ul>
    <p class="tbg-landing-alpha">Currently in controlled alpha. Access is limited to invited managers and testers while the world, match engine and management systems are being developed in public.</p>
    <p><a href="./alpha-guide.html"><strong>Read the controlled-alpha tester guide →</strong></a></p>
  `;

  const signin = document.createElement('section');
  signin.className = 'tbg-landing-signin';
  signin.setAttribute('aria-label', 'Manager sign in');

  card.before(landing);
  signin.append(card);
  landing.append(story, signin);
}

enhanceLandingPage();
addAlphaGuideLinks();
addGovernanceLinks();

async function loadConfig() {
  const response = await fetch("/api/auth-config", { cache: "no-store" });
  const config = await response.json();
  if (!response.ok || !config.configured) {
    throw new Error(config.error || "Supabase is not configured on Netlify yet.");
  }
  return config;
}

function callbackDetails() {
  const query = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  return {
    code: query.get("code"),
    accessToken: hash.get("access_token"),
    refreshToken: hash.get("refresh_token"),
    authError: query.get("error_description") || query.get("error") || hash.get("error_description") || hash.get("error")
  };
}

function restoredPath() {
  const pendingClubId = localStorage.getItem(PENDING_CLUB_KEY) || "";
  const url = new URL(window.location.origin + window.location.pathname);
  if (SAFE_CLUB_ID.test(pendingClubId)) url.searchParams.set("club", pendingClubId);
  return `${url.pathname}${url.search}`;
}

async function completeAuthCallback() {
  const { code, accessToken, refreshToken, authError } = callbackDetails();
  if (!code && !accessToken && !authError) return false;

  const config = await loadConfig();
  const client = createClient(config.supabase_url, config.supabase_anon_key, {
    auth: {
      flowType: "pkce",
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });

  if (authError) {
    const { data } = await client.auth.getSession();
    if (data.session?.access_token) {
      callbackUrlCanBeCleared = true;
      sessionStorage.removeItem("tbg_auth_callback_error");
      history.replaceState({}, document.title, restoredPath());
      return false;
    }
    callbackUrlCanBeCleared = true;
    throw new Error(authError);
  }

  if (code) {
    const { error } = await client.auth.exchangeCodeForSession(code);
    if (error) throw error;
    callbackUrlCanBeCleared = true;
  } else {
    const { error } = await client.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken || ""
    });
    if (error) throw error;
    callbackUrlCanBeCleared = true;
  }

  const { data, error: sessionError } = await client.auth.getSession();
  if (sessionError) throw sessionError;
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
  if (callbackUrlCanBeCleared) history.replaceState({}, document.title, restoredPath());
  console.error("TBG authentication callback failed:", error);
}

await import("./app.js");
await import("./club-claiming.js");
await import("./alpha-feedback.js");
await import("./alpha-updates.js");