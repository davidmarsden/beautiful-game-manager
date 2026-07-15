import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

async function initialiseOtpLogin() {
  const card = document.querySelector(".auth-card");
  const emailInput = document.getElementById("loginEmail");
  const loginStatus = document.getElementById("loginStatus");
  if (!card || !emailInput || !loginStatus) return;

  const response = await fetch("/api/auth-config", { cache: "no-store" });
  const config = await response.json();
  if (!response.ok || !config.configured) return;

  const client = createClient(config.supabase_url, config.supabase_anon_key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  });

  const divider = document.createElement("div");
  divider.className = "auth-divider";
  divider.textContent = "OR ENTER THE EMAIL CODE";

  const form = document.createElement("form");
  form.id = "otpCodeForm";
  form.innerHTML = `
    <label>
      Six-digit code
      <input id="otpCode" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" placeholder="123456" required>
    </label>
    <button class="submit secondary" type="submit">Sign in with code</button>
    <p class="otp-help">Use the six-digit code from the newest TBG email. This avoids browser hand-off problems on tablets.</p>
  `;

  card.append(divider, form);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = emailInput.value.trim();
    const token = document.getElementById("otpCode").value.trim();

    if (!email) {
      loginStatus.className = "error";
      loginStatus.textContent = "Enter your email address above first.";
      return;
    }

    loginStatus.className = "";
    loginStatus.textContent = "Checking your one-time code…";

    const { data, error } = await client.auth.verifyOtp({ email, token, type: "email" });

    if (error || !data.session) {
      loginStatus.className = "error";
      loginStatus.textContent = error?.message || "That code could not create a session.";
      return;
    }

    loginStatus.className = "ok";
    loginStatus.textContent = "Signed in. Opening your club…";
    window.location.replace(window.location.origin);
  });
}

initialiseOtpLogin().catch((error) => {
  console.error("Could not initialise OTP login", error);
});
