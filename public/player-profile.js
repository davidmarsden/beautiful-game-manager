const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
const playerName = (player) => player.display_name || player.player_name || player.canonical_name || player.tbg_player_id || player.player_id || 'Unknown player';
const playerId = (player) => player.tbg_player_id || player.player_id || '';
const rating = (player) => player.underlying_ability_rating ?? player.tbg_rating ?? player.rating ?? '—';
const position = (player) => player.specific_position || player.position || player.primary_position || player.position_group || 'Unknown';
const currentClub = (player, club) => club.club_name || club.canonical_name || player.club_name || 'Current club unavailable';

function accessToken() {
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key?.startsWith('sb-') || !key.endsWith('-auth-token')) continue;
    try {
      const stored = JSON.parse(localStorage.getItem(key));
      const token = stored?.access_token || stored?.currentSession?.access_token;
      if (token) return token;
    } catch {}
  }
  return '';
}

function formatDate(value) {
  if (!value) return 'Open-ended';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return escapeHtml(value);
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function availabilityState(player) {
  const unregistered = player?.registered === false || String(player?.registration_status || '').trim().toLowerCase() === 'unregistered';
  if (unregistered) return { label: 'Unregistered', tone: 'bad' };
  if (player?.loaned_out) return { label: 'Loaned out', tone: 'bad' };
  const label = player.injury_status || player.availability || 'Available';
  const normalized = String(label).trim().toLowerCase();
  const negative = normalized.includes('unavailable') || normalized.includes('injur') || normalized.includes('suspend');
  const positive = normalized === 'available' || normalized === 'fit' || normalized === 'fully fit';
  const tone = negative ? 'bad' : positive ? 'good' : 'neutral';
  return { label, tone };
}

function moraleState(value) {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    if (numeric >= 80) return { label: `${numeric} · Excellent`, tone: 'good' };
    if (numeric >= 65) return { label: `${numeric} · Good`, tone: 'good' };
    if (numeric >= 45) return { label: `${numeric} · Low`, tone: 'neutral' };
    return { label: `${numeric} · Very low`, tone: 'bad' };
  }
  const label = String(value || 'Good');
  const normalized = label.trim().toLowerCase();
  const bad = normalized.includes('very low') || normalized.includes('poor');
  const neutral = normalized === 'low';
  const good = normalized.includes('good') || normalized.includes('excellent');
  const tone = bad ? 'bad' : neutral ? 'neutral' : good ? 'good' : 'neutral';
  return { label, tone };
}

function metric(label, value, extraClass = '') {
  return `<div class="tbg-profile-metric ${extraClass}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}
function emptyState(title, body) { return `<div class="tbg-profile-empty"><strong>${escapeHtml(title)}</strong><p>${escapeHtml(body)}</p></div>`; }

function statisticsPanel(stats = {}) {
  const average = stats.average_match_rating == null ? '—' : Number(stats.average_match_rating).toFixed(1);
  return `<div class="tbg-profile-grid">${metric('Appearances', stats.appearances ?? 0)}${metric('Goals', stats.goals ?? 0)}${metric('Assists', stats.assists ?? 0)}${metric('Average rating', average)}</div>`;
}

function abilityPanel(record) {
  if (!record?.history?.length) return emptyState('No Ability changes yet', 'No governed TBG Ability-rating change has been published for this player.');
  return `<div class="tbg-profile-history"><p class="tbg-profile-history-note">Governed TBG Ability history. Match-performance ratings remain in Statistics.</p>${record.history.map((row) => {
    const delta = Number(row.delta);
    const marker = delta > 0 ? `↑${Math.abs(delta)}` : delta < 0 ? `↓${Math.abs(delta)}` : '→0';
    return `<article class="tbg-profile-history-row"><span>${escapeHtml(formatDate(row.published_at || row.slot))}</span><strong>${escapeHtml(row.before)} → ${escapeHtml(row.after)}</strong><b>${escapeHtml(marker)}</b></article>`;
  }).join('')}</div>`;
}

function tabPanel(name, player) {
  if (name === 'selection') {
    const availability = availabilityState(player);
    const morale = moraleState(player.morale);
    return `<div class="tbg-profile-grid">${metric('Fitness', `${player.fitness ?? 100}%`)}${metric('Morale', morale.label, `status-${morale.tone}`)}${metric('Selection status', availability.label, `status-${availability.tone}`)}${metric('Contract', formatDate(player.contract_expiry || player.contract_end_at || player.contract?.end_at))}</div>`;
  }
  if (name === 'transfers') return emptyState('No transfer history yet', 'In-game moves, fees and contract events will appear here when recorded in the canonical transfer ledger.');
  if (name === 'statistics') return '<div class="tbg-profile-empty"><strong>Loading season statistics…</strong><p>Reading persisted match-performance data from the live archive.</p></div>';
  if (name === 'ability') return '<div class="tbg-profile-empty"><strong>Loading Ability history…</strong><p>Reading governed published rating changes.</p></div>';
  return emptyState('Career history is building', 'Season-by-season clubs, honours and milestones will populate as the canonical world ledger develops.');
}

function statisticsStillActive(panel) {
  if (!panel?.isConnected) return false;
  const host = panel.closest('[data-tbg-player-profile-host]');
  const statisticsTab = host?.querySelector('[data-player-tab="statistics"]');
  return statisticsTab?.getAttribute('aria-selected') === 'true';
}

function abilityStillActive(panel) {
  if (!panel?.isConnected) return false;
  const host = panel.closest('[data-tbg-player-profile-host]');
  const abilityTab = host?.querySelector('[data-player-tab="ability"]');
  return abilityTab?.getAttribute('aria-selected') === 'true';
}

async function loadStatistics(panel, player) {
  const token = accessToken();
  if (!token) {
    if (statisticsStillActive(panel)) panel.innerHTML = emptyState('Statistics unavailable', 'Sign in again to load live match statistics.');
    return;
  }
  try {
    const response = await fetch(`/api/player-profile-stats?player_id=${encodeURIComponent(playerId(player))}`, { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' });
    const stats = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(stats.error || `Player statistics request failed (HTTP ${response.status})`);
    if (!statisticsStillActive(panel)) return;
    panel.innerHTML = statisticsPanel(stats);
  } catch (error) {
    if (!statisticsStillActive(panel)) return;
    panel.innerHTML = emptyState('Statistics unavailable', error.message || 'Could not load persisted match statistics.');
  }
}

async function loadAbility(panel, player) {
  const token = accessToken();
  if (!token) {
    if (abilityStillActive(panel)) panel.innerHTML = emptyState('Ability history unavailable', 'Sign in again to load governed rating history.');
    return;
  }
  try {
    const response = await fetch(`/api/player-rating-history?player_id=${encodeURIComponent(playerId(player))}`, { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Ability history request failed (HTTP ${response.status})`);
    if (!abilityStillActive(panel)) return;
    panel.innerHTML = abilityPanel(payload.player);
  } catch (error) {
    if (!abilityStillActive(panel)) return;
    panel.innerHTML = emptyState('Ability history unavailable', error.message || 'Could not load governed rating history.');
  }
}

function profileIdentity(player, club, pinkFinalLink) {
  const nation = player.nationality || player.country || '';
  const availability = availabilityState(player);
  const pinkFinalAction = pinkFinalLink
    ? `<a class="tbg-pink-final-link" href="${escapeHtml(pinkFinalLink)}" target="_blank" rel="noopener"><img class="tbg-pink-final-mark" src="./tpf-mark.svg" alt=""/><span><small>Real-world profile</small><strong>View in The Pink Final ↗</strong></span></a>`
    : `<div class="tbg-pink-final-link unavailable"><img class="tbg-pink-final-mark" src="./tpf-mark.svg" alt=""/><span><small>Real-world profile</small><strong>Not published yet</strong></span></div>`;
  return `<div class="tbg-player-card"><div class="tbg-player-rating" aria-label="TBG rating ${escapeHtml(rating(player))}"><span>TBG</span><strong>${escapeHtml(rating(player))}</strong></div><div class="tbg-player-summary"><span class="status-label">TBG PLAYER PROFILE</span><h2>${escapeHtml(playerName(player))}</h2><p class="tbg-player-role">${escapeHtml(position(player))}</p><p class="tbg-player-club"><span>Current TBG club</span><strong>${escapeHtml(currentClub(player, club))}</strong></p><div class="tbg-player-chips"><span>Age ${escapeHtml(player.age ?? '—')}</span>${nation ? `<span>${escapeHtml(nation)}</span>` : ''}<span class="status-${availability.tone}">${escapeHtml(availability.label)}</span></div></div><div class="tbg-player-actions">${pinkFinalAction}</div></div>`;
}

export function openTbgPlayerProfile(root, player, club = {}) {
  if (!root || !player) return;
  document.querySelector('[data-tbg-player-profile-host]')?.remove();
  const host = document.createElement('div');
  host.dataset.tbgPlayerProfileHost = '';
  host.className = 'tbg-player-profile-host';
  host.setAttribute('role', 'dialog');
  host.setAttribute('aria-modal', 'true');
  host.setAttribute('aria-label', `${playerName(player)} TBG player profile`);
  const pinkFinalLink = player.profile_url || player.pink_final_profile_url;
  host.innerHTML = `<div class="tbg-player-profile-backdrop" data-close-player></div><section class="tbg-player-profile" data-player-id="${escapeHtml(playerId(player))}"><button type="button" class="tbg-profile-close" data-close-player aria-label="Close player profile">×</button>${profileIdentity(player, club, pinkFinalLink)}<nav class="tbg-profile-tabs" aria-label="Player profile sections"><button class="active" data-player-tab="selection" aria-selected="true">Selection</button><button data-player-tab="transfers" aria-selected="false">Transfers</button><button data-player-tab="statistics" aria-selected="false">Statistics</button><button data-player-tab="ability" aria-selected="false">Ability</button><button data-player-tab="history" aria-selected="false">History</button></nav><div class="tbg-profile-panel" data-player-tab-panel>${tabPanel('selection', player)}</div></section>`;
  document.body.append(host);
  const close = () => { document.removeEventListener('keydown', onKeydown); host.remove(); };
  const onKeydown = (event) => { if (event.key === 'Escape') close(); };
  document.addEventListener('keydown', onKeydown);
  host.querySelectorAll('[data-close-player]').forEach((button) => button.addEventListener('click', close));
  host.querySelectorAll('[data-player-tab]').forEach((button) => button.addEventListener('click', () => {
    host.querySelectorAll('[data-player-tab]').forEach((candidate) => { const selected = candidate === button; candidate.classList.toggle('active', selected); candidate.setAttribute('aria-selected', String(selected)); });
    const panel = host.querySelector('[data-player-tab-panel]');
    const tab = button.dataset.playerTab;
    panel.innerHTML = tabPanel(tab, player);
    if (tab === 'statistics') loadStatistics(panel, player);
    if (tab === 'ability') loadAbility(panel, player);
  }));
  host.querySelector('.tbg-profile-close')?.focus();
}

export { statisticsPanel, abilityPanel };