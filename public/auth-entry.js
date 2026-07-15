import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

async function completeAuthCallback() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  const authError = params.get("error_description") || params.get("error");

  if (authError) {
    sessionStorage.setItem("tbg_auth_callback_error", authError);
    history.replaceState({}, document.title, window.location.pathname);
    return;
  }

  if (!code) return;

  const response = await fetch("/api/auth-config", { cache: "no-store" });
  const config = await response.json();
  if (!response.ok || !config.configured) {
    throw new Error(config.error || "Supabase is not configured on Netlify yet.");
  }

  const client = createClient(config.supabase_url, config.supabase_anon_key, {
    auth: {
      flowType: "pkce",
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false
    }
  });

  const { error } = await client.auth.exchangeCodeForSession(code);
  if (error) throw error;

  history.replaceState({}, document.title, window.location.pathname);
}

try {
  await completeAuthCallback();
} catch (error) {
  sessionStorage.setItem("tbg_auth_callback_error", error.message || "Could not complete sign-in.");
  history.replaceState({}, document.title, window.location.pathname);
}

await import("./app.js");
