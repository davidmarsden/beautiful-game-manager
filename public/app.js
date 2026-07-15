import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const $ = (id) => document.getElementById(id);
let state = null;
let supabase = null;
let session = null;
let sort = { key: "position_order", dir: "asc" };

const nameOf = (p) => p.display_name || p.player_name || p.canonical_name || p.tbg_player_id;
const ratingOf = (p) => p.underlying_ability_rating || p.tbg_rating || p.tbgRating || p.rating || 0;
const posOf = (p) => p.specific_position || p.position || p.primary_position || p.position_group || "Unknown";
const POSITION_ORDER = ["Goalkeeper","Centre-Back","Left-Back","Right-Back","Left Wing-Back","Right Wing-Back","Defensive Midfield","Central Midfield","Attacking Midfield","Left Winger","Right Winger","Second Striker","Centre-Forward","Unknown"];
const POSITION_ALIASES = new Map([
  ["gk","Goalkeeper"],["goalkeeper","Goalkeeper"],["cb","Centre-Back"],["centre-back","Centre-Back"],["center-back","Centre-Back"],["central defender","Centre-Back"],
  ["lb","Left-Back"],["left-back","Left-Back"],["left back","Left-Back"],["rb","Right-Back"],["right-back","Right-Back"],["right back","Right-Back"],
  ["lwb","Left Wing-Back"],["left wing-back","Left Wing-Back"],["rwb","Right Wing-Back"],["right wing-back","Right Wing-Back"],
  ["dm","Defensive Midfield"],["defensive midfield","Defensive Midfield"],["defensive midfielder","Defensive Midfield"],
  ["cm","Central Midfield"],["central midfield","Central Midfield"],["central midfielder","Central Midfield"],
  ["am","Attacking Midfield"],["attacking midfield","Attacking Midfield"],["attacking midfielder","Attacking Midfield"],
  ["lw","Left Winger"],["left winger","Left Winger"],["left wing","Left Winger"],["rw","Right Winger"],["right winger","Right Winger"],["right wing","Right Winger"],
  ["ss","Second Striker"],["second striker","Second Striker"],["cf","Centre-Forward"],["st","Centre-Forward"],["centre-forward","Centre-Forward"],["center-forward","Centre-Forward"],["striker","Centre-Forward"]
]);
const canonicalPosition = (p) => POSITION_ALIASES.get(String(posOf(p)).trim().toLowerCase()) || posOf(p) || "Unknown";
const positionIndex = (p) => { const index = POSITION_ORDER.indexOf(canonicalPosition(p)); return index === -1 ? POSITION_ORDER.length : index; };
const isYouth = (p) => Boolean(p.youth_eligible_at_season_start ?? ((Number(p.season_start_age ?? p.age) || 99) <= 21));
const isLoanedOut = (p) => Boolean(p.loaned_out || String(p.loan_status || "").toLowerCase() === "loaned_out");
const inRegistrationView = (p, view) => view === "full" ? true : view === "youth" ? isYouth(p) && !isLoanedOut(p) : view === "loaned_out" ? isLoanedOut(p) : !isYouth(p) && !isLoanedOut(p);

function setAuthView(authenticated) {
  $("authGate").hidden = authenticated;
  $("portal").hidden = !authenticated;
}

function showView(name) {
  document.querySelectorAll(".view").forEach((view) => view.classList.toggle("active", view.id === `${name}View`));
  document.querySelectorAll("[data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === name));
}

function renderNav(items) {
  $("clubNav").innerHTML = items.map((item) => `<a href="#">${item}</a>`).join("");
  $("clubNav").querySelectorAll("a").forEach((link, index) => link.addEventListener("click", (event) => {
    event.preventDefault();
    showView(index === 1 ? "squad" : index === 2 ? "tactics" : index === 3 ? "schedule" : "dashboard");
  }));
}

function pick(player, zone, index) {
  return `<label class="player-pick"><input type="checkbox" data-zone="${zone}" value="${player.tbg_player_id}" ${zone === "xi" && index < 11 ? "checked" : ""}><span>${nameOf(player)} · ${canonicalPosition(player)} · ${ratingOf(player)}</span></label>`;
}

function refreshCaptain() {
  const selected = [...document.querySelectorAll('input[data-zone="xi"]:checked')];
  $("captain").innerHTML = selected.map((input) => {
    const player = state.squad.find((row) => row.tbg_player_id === input.value);
    return `<option value="${input.value}">${nameOf(player)}</option>`;
  }).join("");
}

function compare(a, b, key) {
  if (key === "position_order") {
    const positionDifference = positionIndex(a) - positionIndex(b);
    if (positionDifference) return sort.dir === "asc" ? positionDifference : -positionDifference;
    const ratingDifference = ratingOf(b) - ratingOf(a);
    if (ratingDifference) return ratingDifference;
    const ageDifference = (Number(a.age) || 99) - (Number(b.age) || 99);
    if (ageDifference) return ageDifference;
    return nameOf(a).localeCompare(nameOf(b), undefined, { sensitivity: "base" });
  }
  const av = key === "display_name" ? nameOf(a) : key === "specific_position" ? canonicalPosition(a) : key === "underlying_ability_rating" ? ratingOf(a) : a[key];
  const bv = key === "display_name" ? nameOf(b) : key === "specific_position" ? canonicalPosition(b) : key === "underlying_ability_rating" ? ratingOf(b) : b[key];
  const result = (typeof av === "number" || typeof bv === "number") ? (Number(av) || 0) - (Number(bv) || 0) : String(av ?? "").localeCompare(String(bv ?? ""), undefined, { numeric: true, sensitivity: "base" });
  return sort.dir === "asc" ? result : -result;
}

function statusBadge(player) {
  const badges = [];
  if (player.transfer_listed) badges.push('<span class="badge transfer">Listed</span>');
  if (player.loan_listed) badges.push('<span class="badge loan">Loan list</span>');
  if (isLoanedOut(player)) badges.push(`<span class="badge loaned">Loaned${player.loan_club_name ? ` · ${player.loan_club_name}` : ""}</span>`);
  return badges.join(" ") || '<span class="badge neutral">Not listed</span>';
}

function playerRow(player) {
  return `<tr><td>${player.squad_number ?? "—"}</td><td><a class="player-link" href="${player.profile_url}" target="_blank" rel="noopener">${nameOf(player)}</a></td><td>${canonicalPosition(player)}</td><td>${player.age ?? "—"}</td><td><strong>${ratingOf(player) || "—"}</strong></td><td>${player.fitness ?? 100}%</td><td>${player.morale || "Good"}</td><td><span class="badge ${String(player.injury_status).toLowerCase() === "available" ? "fit" : "injured"}">${player.injury_status || "Available"}</span></td><td>${player.contract_expiry || "Open-ended"}</td><td>${statusBadge(player)}</td></tr>`;
}

function renderRows(rows) {
  if (sort.key !== "position_order") return rows.map(playerRow).join("");
  let previousPosition = "";
  return rows.map((player) => {
    const position = canonicalPosition(player);
    const separator = position !== previousPosition ? `<tr class="position-separator"><td colspan="10">${position}</td></tr>` : "";
    previousPosition = position;
    return separator + playerRow(player);
  }).join("");
}

function renderSquadSummary() {
  const rules = state.squad_rules || state.club.squad?.rules || {};
  const firstTeam = state.squad.filter((p) => !isYouth(p) && !isLoanedOut(p)).length;
  const youth = state.squad.filter((p) => isYouth(p) && !isLoanedOut(p)).length;
  const loaned = state.squad.filter(isLoanedOut).length;
  $("firstTeamSummary").textContent = `${firstTeam} / ${rules.first_team_capacity ?? 25}`;
  $("youthTeamSummary").textContent = `${youth} / ${rules.youth_team_capacity ?? 20}`;
  $("loanedOutSummary").textContent = loaned;
  $("totalOwnedSummary").textContent = state.squad.length;
}

function renderSquad() {
  const registration = $("registrationFilter").value;
  const query = $("squadSearch").value.toLowerCase();
  const position = $("positionFilter").value;
  const availability = $("availabilityFilter").value;
  let rows = state.squad.filter((p) => inRegistrationView(p, registration)).filter((p) => `${nameOf(p)} ${canonicalPosition(p)}`.toLowerCase().includes(query));
  if (position !== "all") rows = rows.filter((p) => canonicalPosition(p) === position);
  if (availability === "available") rows = rows.filter((p) => String(p.injury_status).toLowerCase() === "available");
  if (availability === "injured") rows = rows.filter((p) => String(p.injury_status).toLowerCase() !== "available");
  if (availability === "listed") rows = rows.filter((p) => p.transfer_listed);
  if (availability === "loan") rows = rows.filter((p) => p.loan_listed);
  rows.sort((a, b) => compare(a, b, sort.key));
  const label = { full: "Full Team", first_team: "First Team", youth: "Youth Team", loaned_out: "Loaned Out" }[registration];
  $("squadResultCount").textContent = `${label} · ${rows.length} players`;
  $("squadRows").innerHTML = rows.length ? renderRows(rows) : '<tr><td colspan="10" class="empty-state">No players match this squad view and filter.</td></tr>';
  document.querySelectorAll("#squadTable th[data-sort]").forEach((header) => {
    header.classList.toggle("active-sort", header.dataset.sort === sort.key);
    header.dataset.arrow = header.dataset.sort === sort.key ? (sort.dir === "asc" ? "▲" : "▼") : "";
  });
}

function renderInbox(messages = []) {
  $("inboxList").innerHTML = messages.length ? messages.map((message) => `<article class="inbox-message ${message.read_at ? "read" : "unread"}"><span>${message.priority}</span><h3>${message.subject}</h3><p>${message.body}</p><small>${new Date(message.created_at).toLocaleString()}</small></article>`).join("") : '<p class="empty-state">No messages yet.</p>';
}

function renderUnassigned(data) {
  state = data;
  renderNav(data.navigation || []);
  $("managerChip").textContent = data.manager.display_name;
  $("unassignedManager").textContent = `${data.manager.display_name} · ${data.user.email || "signed in"}`;
  $("unassignedState").hidden = false;
  $("clubPortal").hidden = true;
}

function render(data) {
  if (data.no_assignment) return renderUnassigned(data);
  state = data;
  $("unassignedState").hidden = true;
  $("clubPortal").hidden = false;
  renderNav(data.navigation);
  $("managerChip").textContent = data.manager.display_name;
  $("clubName").textContent = data.club.canonical_name;
  $("crest").textContent = (data.club.short_name || data.club.canonical_name).split(/\s+/).map((word) => word[0]).join("").slice(0, 3).toUpperCase();
  $("clubMeta").textContent = `${data.club.division_id ? data.club.division_id.replace("division-", "Division ") : "Unseeded"} · World rank ${data.club.strength?.world_rank || "—"}`;
  const fixture = data.next_fixture;
  $("nextOpponent").textContent = fixture?.opponent_name || "No fixture scheduled";
  $("fixtureMeta").textContent = fixture?.competition || "";
  $("deadlineText").textContent = fixture?.submission_deadline_at ? `Team deadline ${new Date(fixture.submission_deadline_at).toLocaleString()}` : "";
  $("worldName").textContent = "TBG World 1";
  $("worldStatus").textContent = data.world.status;
  $("nextFixtureCard").textContent = fixture ? `${fixture.opponent_name} · ${fixture.venue}` : "No fixture scheduled";
  $("division").textContent = data.club.division_id ? data.club.division_id.replace("division-", "Division ") : "—";
  $("rank").textContent = data.club.strength?.world_rank || "—";
  $("squadCount").textContent = data.squad.length;
  renderInbox(data.messages);
  const positions = [...new Set(data.squad.map(canonicalPosition))].sort((a, b) => {
    const ai = POSITION_ORDER.indexOf(a), bi = POSITION_ORDER.indexOf(b);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi) || a.localeCompare(b);
  });
  $("positionFilter").innerHTML = '<option value="all">All positions</option>' + positions.map((position) => `<option>${position}</option>`).join("");
  renderSquadSummary();
  renderSquad();
  const ordered = [...data.squad].filter((p) => !isLoanedOut(p)).sort((a, b) => positionIndex(a) - positionIndex(b) || ratingOf(b) - ratingOf(a));
  $("startingXi").innerHTML = ordered.map((player, index) => pick(player, "xi", index)).join("");
  $("bench").innerHTML = ordered.map((player, index) => pick(player, "bench", index)).join("");
  document.querySelectorAll('input[data-zone="xi"]').forEach((input) => input.addEventListener("change", refreshCaptain));
  refreshCaptain();
  $("decisionForm").querySelector('button[type="submit"]').disabled = !fixture;
}

async function loadPortal() {
  const response = await fetch("/api/bootstrap", { headers: { authorization: `Bearer ${session.access_token}` } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Could not load manager portal");
  render(data);
}

async function submitDecision(event) {
  event.preventDefault();
  if (!state.next_fixture) return;
  const payload = {
    manager_id: state.manager.id,
    club_id: state.club.tbg_club_id,
    fixture_id: state.next_fixture.fixture_id,
    formation: $("formation").value,
    starting_xi: [...document.querySelectorAll('input[data-zone="xi"]:checked')].map((input) => input.value),
    bench: [...document.querySelectorAll('input[data-zone="bench"]:checked')].map((input) => input.value),
    captain_id: $("captain").value,
    set_piece_takers: { penalties: $("captain").value, free_kicks: $("captain").value, corners_left: $("captain").value, corners_right: $("captain").value },
    tactics: { mentality: $("mentality").value, pressing: $("pressing").value, tempo: $("tempo").value, width: $("width").value, defensive_line: $("defensiveLine").value }
  };
  const response = await fetch("/api/decisions", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${session.access_token}` }, body: JSON.stringify(payload) });
  const result = await response.json();
  $("submissionStatus").className = response.ok ? "ok" : "error";
  $("submissionStatus").textContent = response.ok ? `Team validated at ${new Date(result.submitted_at).toLocaleString()}` : (result.validation_errors || [result.error]).join(" · ");
}

async function initialiseAuth() {
  const configResponse = await fetch("/api/auth-config");
  const config = await configResponse.json();
  if (!config.configured) {
    $("loginStatus").className = "error";
    $("loginStatus").textContent = "Supabase is not configured on Netlify yet.";
    return;
  }
  supabase = createClient(config.supabase_url, config.supabase_anon_key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  const { data } = await supabase.auth.getSession();
  session = data.session;
  setAuthView(Boolean(session));
  if (session) await loadPortal().catch((error) => { $("portal").innerHTML = `<div class="fatal-error">${error.message}</div>`; });
  supabase.auth.onAuthStateChange(async (_event, nextSession) => {
    session = nextSession;
    setAuthView(Boolean(session));
    if (session) await loadPortal();
  });
}

$("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("loginStatus").className = "";
  $("loginStatus").textContent = "Sending secure login link…";
  const email = $("loginEmail").value.trim();
  const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } });
  $("loginStatus").className = error ? "error" : "ok";
  $("loginStatus").textContent = error ? error.message : "Check your email for the TBG sign-in link.";
});
$("logoutButton").addEventListener("click", async () => { await supabase.auth.signOut(); window.location.reload(); });
document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => showView(button.dataset.view)));
$("decisionForm").addEventListener("submit", submitDecision);
["registrationFilter","squadSearch","positionFilter","availabilityFilter"].forEach((id) => $(id).addEventListener(id === "squadSearch" ? "input" : "change", renderSquad));
document.querySelectorAll("#squadTable th[data-sort]").forEach((header) => header.addEventListener("click", () => {
  const key = header.dataset.sort;
  if (key === "specific_position") sort = sort.key === "position_order" ? { key: "specific_position", dir: "desc" } : { key: "position_order", dir: "asc" };
  else sort = sort.key === key ? { key: sort.key, dir: sort.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" };
  renderSquad();
}));

initialiseAuth().catch((error) => {
  $("loginStatus").className = "error";
  $("loginStatus").textContent = error.message;
});
