const ROLE_LABELS = Object.freeze({
  gk: 'Goalkeeper',
  cb: 'Centre-back',
  fb: 'Full-back',
  wing_back: 'Wing-back',
  dm: 'Defensive midfield',
  cm: 'Central midfield',
  am: 'Attacking midfield',
  wide_mid: 'Wide midfield',
  wing: 'Winger',
  st: 'Striker'
});

const UNIT_FOR_ROLE = Object.freeze({
  gk: 'goalkeeping', cb: 'defence', fb: 'defence', wing_back: 'defence',
  dm: 'midfield', cm: 'midfield', am: 'midfield', wide_mid: 'midfield',
  wing: 'attack', st: 'attack'
});

const POSITION_GROUPS = Object.freeze({
  gk: ['gk','goalkeeper'],
  cb: ['cb','centre back','center back','centre-back','center-back','defender'],
  fb: ['rb','lb','right back','left back','right-back','left-back','full back','full-back'],
  wing_back: ['rwb','lwb','right wing-back','left wing-back','wing back','wing-back'],
  dm: ['dm','defensive midfield','defensive midfielder','holding midfield'],
  cm: ['cm','central midfield','central midfielder','midfielder'],
  am: ['am','attacking midfield','attacking midfielder','number 10'],
  wide_mid: ['rm','lm','right midfield','left midfield','wide midfield'],
  wing: ['rw','lw','right winger','left winger','winger','wide forward'],
  st: ['st','cf','striker','centre forward','center forward','centre-forward','center-forward','forward','attacker']
});

const ADJACENT = Object.freeze({
  cb: ['fb','wing_back','dm'],
  fb: ['cb','wing_back','wide_mid'],
  wing_back: ['fb','wide_mid','wing'],
  dm: ['cb','cm'],
  cm: ['dm','am','wide_mid'],
  am: ['cm','wing','st'],
  wide_mid: ['fb','wing_back','cm','wing'],
  wing: ['wide_mid','am','st','wing_back'],
  st: ['am','wing']
});

const BOARD_ROLE = Object.freeze({
  GK: 'gk', CB: 'cb', LCB: 'cb', RCB: 'cb', LB: 'fb', RB: 'fb', LWB: 'wing_back', RWB: 'wing_back',
  LDM: 'dm', RDM: 'dm', CM: 'cm', LCM: 'cm', RCM: 'cm', AM: 'am', LM: 'wide_mid', RM: 'wide_mid',
  LW: 'wing', RW: 'wing', CF: 'st', LCF: 'st', RCF: 'st'
});

let snapshot = null;
let applying = false;
const norm = (value) => String(value ?? '').trim().toLowerCase();

function positionOf(player = {}) {
  return player.specific_position || player.position || player.primary_position || player.position_group || 'Unknown';
}

function canonicalRoleFromPosition(position) {
  const value = norm(position);
  for (const [role, aliases] of Object.entries(POSITION_GROUPS)) {
    if (aliases.includes(value)) return role;
  }
  if (value.includes('goal')) return 'gk';
  if (value.includes('back')) return value.includes('wing') ? 'wing_back' : value.includes('centre') || value.includes('center') ? 'cb' : 'fb';
  if (value.includes('defensive')) return 'dm';
  if (value.includes('attacking')) return 'am';
  if (value.includes('wing')) return 'wing';
  if (value.includes('mid')) return 'cm';
  if (value.includes('forward') || value.includes('striker')) return 'st';
  return 'unknown';
}

function roleSuitability(actualRole, requiredRole) {
  if (actualRole === requiredRole) return { tier: 'natural', factor: 1 };
  if (actualRole === 'gk' || requiredRole === 'gk') return { tier: 'emergency', factor: 0.72 };
  if ((ADJACENT[requiredRole] || []).includes(actualRole) || (ADJACENT[actualRole] || []).includes(requiredRole)) return { tier: 'comfortable', factor: 0.96 };
  if (UNIT_FOR_ROLE[requiredRole] && UNIT_FOR_ROLE[requiredRole] === UNIT_FOR_ROLE[actualRole]) return { tier: 'cover', factor: 0.91 };
  if (actualRole === 'unknown') return { tier: 'unknown', factor: 0.88 };
  return { tier: 'emergency', factor: 0.84 };
}

function playableRoles(player) {
  const natural = canonicalRoleFromPosition(positionOf(player));
  if (natural === 'unknown') return { natural, comfortable: [], cover: [] };
  if (natural === 'gk') return { natural, comfortable: [], cover: [] };
  const comfortable = Object.keys(ROLE_LABELS).filter((role) => role !== natural && roleSuitability(natural, role).tier === 'comfortable');
  const cover = Object.keys(ROLE_LABELS).filter((role) => role !== natural && roleSuitability(natural, role).tier === 'cover');
  return { natural, comfortable, cover };
}

function playerDirectory() {
  return new Map((snapshot?.squad || []).map((player) => [String(player.tbg_player_id || player.player_id || ''), player]));
}

function playerByName(name) {
  const wanted = String(name || '').trim();
  return (snapshot?.squad || []).find((player) => String(player.display_name || player.player_name || player.name || '').trim() === wanted) || null;
}

function summary(player) {
  const roles = playableRoles(player);
  const comfortable = roles.comfortable.map((role) => ROLE_LABELS[role]);
  const cover = roles.cover.map((role) => ROLE_LABELS[role]);
  return { roles, comfortable, cover };
}

function enhanceSquadRows() {
  document.querySelectorAll('#squadRows tr:not(.position-separator)').forEach((row) => {
    const cells = row.querySelectorAll('td');
    const name = row.querySelector('.player-link')?.textContent?.trim();
    const player = playerByName(name);
    if (!player || !cells[2] || cells[2].querySelector('.position-versatility')) return;
    const info = summary(player);
    const details = [
      info.comfortable.length ? `Comfortable: ${info.comfortable.join(', ')}` : '',
      info.cover.length ? `Cover: ${info.cover.join(', ')}` : ''
    ].filter(Boolean).join(' · ');
    if (!details) return;
    cells[2].insertAdjacentHTML('beforeend', `<small class="position-versatility">${details}</small>`);
  });
}

function enhanceLegacyPicks() {
  const directory = playerDirectory();
  document.querySelectorAll('.player-pick').forEach((label) => {
    if (label.dataset.versatilityEnhanced === 'true') return;
    const input = label.querySelector('input');
    const player = directory.get(String(input?.value || ''));
    const span = label.querySelector('span');
    if (!player || !span) return;
    const info = summary(player);
    const extra = [...info.comfortable, ...info.cover].slice(0, 4);
    if (extra.length) span.textContent += ` · also ${extra.join(' / ')}`;
    label.dataset.versatilityEnhanced = 'true';
  });
}

function enhanceFormationSlots() {
  const directory = playerDirectory();
  document.querySelectorAll('#formationPitch .formation-slot[data-role]').forEach((slot) => {
    const playerId = slot.querySelector('[data-player-id]')?.dataset.playerId;
    const player = directory.get(String(playerId || ''));
    const requiredRole = BOARD_ROLE[slot.dataset.role];
    const token = slot.querySelector('.player-token');
    if (!player || !requiredRole || !token) return;
    const actualRole = canonicalRoleFromPosition(positionOf(player));
    const fit = roleSuitability(actualRole, requiredRole);
    token.classList.remove('versatility-natural','versatility-comfortable','versatility-cover','versatility-emergency','suitability-warning');
    token.classList.add(`versatility-${fit.tier}`);
    if (fit.tier === 'emergency' || fit.tier === 'unknown') token.classList.add('suitability-warning');
    token.querySelector('.versatility-fit')?.remove();
    const label = fit.tier === 'natural' ? 'Natural' : fit.tier === 'comfortable' ? 'Comfortable' : fit.tier === 'cover' ? 'Cover' : fit.tier === 'unknown' ? 'Unknown fit' : 'Emergency';
    token.insertAdjacentHTML('beforeend', `<small class="versatility-fit" title="Role suitability ${Math.round(fit.factor * 100)}%">${label}</small>`);
  });
}

function ensureCanPlayFilter() {
  const existing = document.getElementById('versatilityFilter');
  if (existing) return existing;
  const primary = document.getElementById('positionFilter');
  if (!primary) return null;
  const select = document.createElement('select');
  select.id = 'versatilityFilter';
  select.setAttribute('aria-label', 'Can play role');
  select.innerHTML = '<option value="all">Can play: any role</option>' + Object.entries(ROLE_LABELS).map(([role, label]) => `<option value="${role}">${label}</option>`).join('');
  primary.insertAdjacentElement('afterend', select);
  select.addEventListener('change', () => {
    if (select.value !== 'all') {
      primary.value = 'all';
      primary.dispatchEvent(new Event('change', { bubbles: true }));
    }
    queueMicrotask(applyCanPlayFilter);
  });
  primary.addEventListener('change', () => {
    if (primary.value !== 'all') select.value = 'all';
  });
  return select;
}

function applyCanPlayFilter() {
  const select = document.getElementById('versatilityFilter');
  const role = select?.value || 'all';
  if (role === 'all') return;
  document.querySelectorAll('#squadRows tr:not(.position-separator)').forEach((row) => {
    const name = row.querySelector('.player-link')?.textContent?.trim();
    const player = playerByName(name);
    if (!player) return;
    const natural = canonicalRoleFromPosition(positionOf(player));
    const tier = roleSuitability(natural, role).tier;
    row.hidden = !['natural','comfortable','cover'].includes(tier);
  });
  document.querySelectorAll('#squadRows .position-separator').forEach((row) => { row.hidden = true; });
}

function apply() {
  if (applying || !snapshot?.squad) return;
  applying = true;
  try {
    ensureCanPlayFilter();
    enhanceSquadRows();
    enhanceLegacyPicks();
    enhanceFormationSlots();
    applyCanPlayFilter();
  } finally {
    applying = false;
  }
}

window.addEventListener('tbg:portal-rendered', (event) => {
  snapshot = event.detail || snapshot;
  queueMicrotask(apply);
});
window.addEventListener('tbg:formation-board-ready', () => queueMicrotask(apply));
document.addEventListener('change', (event) => {
  if (event.target?.id === 'formation') queueMicrotask(apply);
});
new MutationObserver(() => queueMicrotask(apply)).observe(document.documentElement, { childList: true, subtree: true });

window.tbgPositionVersatility = Object.freeze({ canonicalRoleFromPosition, roleSuitability, playableRoles });
