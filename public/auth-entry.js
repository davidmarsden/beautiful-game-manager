import './portal-v1.js';
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

async function completeAuthCallback() {
  const { code, accessToken, refreshToken, authError } = callbackDetails();
  if (authError) throw new Error(authError);
  if (!code && !accessToken) return false;

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

  const { data, error: sessionError } = await client.auth.getSession();
  if (sessionError) throw sessionError;
  if (!data.session?.access_token) {
    throw new Error("Supabase returned from the sign-in link, but no browser session was saved.");
  }

  sessionStorage.removeItem("tbg_auth_callback_error");
  history.replaceState({}, document.title, window.location.pathname);
  return true;
}

try {
  await completeAuthCallback();
} catch (error) {
  const message = error?.message || "Could not complete sign-in.";
  sessionStorage.setItem("tbg_auth_callback_error", message);
  console.error("TBG authentication callback failed:", error);
}

await import("./app.js");
