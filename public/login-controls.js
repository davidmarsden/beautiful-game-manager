import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const $ = (id) => document.getElementById(id);
let clientPromise = null;

async function client() {
  if (!clientPromise) {
    clientPromise = (async () => {
      const response = await fetch("/api/auth-config", { cache: "no-store" });
      const config = await response.json();
      if (!response.ok || !config.configured) throw new Error(config.error || "Supabase is not configured on Netlify yet.");
      return createClient(config.supabase_url, config.supabase_anon_key, {
        auth: { flowType: "pkce", persistSession: true, autoRefreshToken: false, detectSessionInUrl: false }
      });
    })();
  }
  return clientPromise;
}

$("loginForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = $("loginEmail")?.value.trim() || "";
  const password = $("loginPassword")?.value || "";
  const status = $("loginStatus");
  if (!email || !password) {
    status.className = "error";
    status.textContent = "Enter your email address and password, or use the email login-link option.";
    return;
  }
  status.className = "";
  status.textContent = "Signing in…";
  try {
    const supabase = await client();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    status.className = "ok";
    status.textContent = "Signed in. Loading your manager portal…";
    window.location.reload();
  } catch (error) {
    status.className = "error";
    status.textContent = error?.message || "Could not sign in.";
  }
});

$("magicLinkButton")?.addEventListener("click", async (event) => {
  event.preventDefault();
  const email = $("loginEmail")?.value.trim() || "";
  const status = $("loginStatus");
  if (!email) {
    status.className = "error";
    status.textContent = "Enter your registered email address first.";
    $("loginEmail")?.focus();
    return;
  }
  status.className = "";
  status.textContent = "Sending secure login link…";
  try {
    const response = await fetch("/api/request-login-link", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, redirect_to: `${window.location.origin}/` })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Could not send login link");
    status.className = "ok";
    status.textContent = "Check your email for the TBG sign-in link.";
  } catch (error) {
    status.className = "error";
    status.textContent = error?.message || "Could not send login link.";
  }
});
