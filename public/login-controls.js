import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const $ = (id) => document.getElementById(id);
const AUTH_TIMEOUT_MS = 12000;
let clientPromise = null;

function statusMessage(message, className = "") {
  const status = $("loginStatus");
  if (!status) return;
  status.className = className;
  status.textContent = message;
}

function timeoutAfter(label, milliseconds = AUTH_TIMEOUT_MS) {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(milliseconds / 1000)} seconds.`)), milliseconds);
  });
}

async function withTimeout(promise, label, milliseconds = AUTH_TIMEOUT_MS) {
  return Promise.race([promise, timeoutAfter(label, milliseconds)]);
}

async function client() {
  if (!clientPromise) {
    clientPromise = (async () => {
      statusMessage("Connecting to TBG…");
      const response = await withTimeout(
        fetch("/api/auth-config", { cache: "no-store" }),
        "Loading TBG sign-in configuration"
      );
      const config = await withTimeout(response.json(), "Reading TBG sign-in configuration");
      if (!response.ok || !config.configured) throw new Error(config.error || "Supabase is not configured on Netlify yet.");
      statusMessage("Sign-in service connected. Checking credentials…");
      return createClient(config.supabase_url, config.supabase_anon_key, {
        auth: { flowType: "pkce", persistSession: true, autoRefreshToken: false, detectSessionInUrl: false }
      });
    })().catch((error) => {
      clientPromise = null;
      throw error;
    });
  }
  return clientPromise;
}

$("loginForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = $("loginEmail")?.value.trim() || "";
  const password = $("loginPassword")?.value || "";
  if (!email || !password) {
    statusMessage("Enter your email address and password, or use the email login-link option.", "error");
    return;
  }

  statusMessage("Signing in…");
  try {
    const supabase = await client();
    statusMessage("Checking credentials…");
    const result = await withTimeout(
      supabase.auth.signInWithPassword({ email, password }),
      "Supabase password sign-in"
    );
    if (result.error) throw result.error;
    if (!result.data?.session?.access_token) throw new Error("Sign-in succeeded but no browser session was returned.");
    statusMessage("Signed in. Loading your manager portal…", "ok");
    window.location.reload();
  } catch (error) {
    console.error("TBG password sign-in failed:", error);
    statusMessage(error?.message || "Could not sign in.", "error");
  }
});

$("magicLinkButton")?.addEventListener("click", async (event) => {
  event.preventDefault();
  const email = $("loginEmail")?.value.trim() || "";
  if (!email) {
    statusMessage("Enter your registered email address first.", "error");
    $("loginEmail")?.focus();
    return;
  }

  statusMessage("Sending secure login link…");
  try {
    const response = await withTimeout(
      fetch("/api/request-login-link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, redirect_to: `${window.location.origin}/` })
      }),
      "Sending secure login link"
    );
    const result = await withTimeout(response.json().catch(() => ({})), "Reading login-link response");
    if (!response.ok) throw new Error(result.error || "Could not send login link");
    statusMessage("Check your email for the TBG sign-in link.", "ok");
  } catch (error) {
    console.error("TBG magic-link request failed:", error);
    statusMessage(error?.message || "Could not send login link.", "error");
  }
});
