import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

async function loadConfig() {
  const response = await fetch("/api/auth-config", { cache: "no-store" });
  const config = await response.json();
  if (!response.ok || !config.configured) {
    throw new Error(config.error || "Supabase is not configured on Netlify yet.");
  }
  return config;
}

async function completeAuthCallback() {
  const query = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const code = query.get("code");
  const accessToken = hash.get("access_token");
  const refreshToken = hash.get("refresh_token");
  const authError = query.get("error_description") || query.get("error") || hash.get("error_description") || hash.get("error");

  if (authError) throw new Error(authError);
  if (!code && !accessToken) return;

  const config = await loadConfig();
  const client = createClient(config.supabase_url, config.supabase_anon_key, {
    auth: {
      flowType: "pkce",
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false
    }
  });

  if (code) {
    const { error } = await client.auth.exchangeCodeForSession(code);
    if (error) throw error;
  } else {
    const { error } = await client.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken || ""
    });
    if (error) throw error;
  }

  history.replaceState({}, document.title, window.location.pathname);
}

try {
  await completeAuthCallback();
} catch (error) {
  sessionStorage.setItem("tbg_auth_callback_error", error.message || "Could not complete sign-in.");
  history.replaceState({}, document.title, window.location.pathname);
}

await import("./app.js");
