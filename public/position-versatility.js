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

const FORMATION_ROLES = Object.freeze({
  '4-4-2': ['gk','fb','cb','cb','fb','wide_mid','cm','cm','wide_mid','st','st'],
  '4-3-3-wide': ['gk','fb','cb','cb','fb','dm','cm','cm','wing','st','wing'],
  '4-2-3-1': ['gk','fb','cb','cb','fb','dm','dm','wing','am','wing','st'],
  '4-1-4-1': ['gk','fb','cb','cb','fb','dm','wide_mid','cm','cm','wide_mid','st'],
  '3-5-2': ['gk','cb','cb','cb','wing_back','cm','dm','cm','wing_back','st','st'],
  '3-4-3': ['gk','cb','cb','cb','wing_back','cm','cm','wing_back','wing','st','wing'],
  '5-3-2': ['gk','wing_back','cb','cb','cb','wing_back','dm','cm','cm','st','st']
});

let snapshot = null;
let applying = false;
const norm = (value) => String(value ?? '').trim().toLowerCase();

function positionOf(player = {}) {
  return player.position
    || player.primary_position
    || player.position_name
    || player.position_detail
    || player.canonical_position
    || player.transfermarkt_position
    || player.position_group
    || 'Unknown';
}

function ratingOf(player = {}) {
  const value = Number(
    player.underlying_ability_rating
    ?? player.tbg_rating
    ?? player.tbgRating
    ?? player.rating
    ?? player.ability
  );
  return Number.isFinite(value) ? value : 0;
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

function requiredRoleForSlot(slot, index) {
  const formation = document.getElementById('formation')?.value || '4-3-3-wide';
  return FORMATION_ROLES[formation]?.[index] || null;
}

function enhanceFormationSlots() {
  const directory = playerDirectory();
  document.querySelectorAll('#formationPitch .formation-slot[data-role]').forEach((slot, index) => {
    const playerId = slot.querySelector('[data-player-id]')?.dataset.playerId;
    const player = directory.get(String(playerId || ''));
    const requiredRole = requiredRoleForSlot(slot, index);
    const token = slot.querySelector('.player-token');
    if (!player || !requiredRole || !token) return;
    const actualRole = canonicalRoleFromPosition(positionOf(player));
    const fit = roleSuitability(actualRole, requiredRole);
    const existingBadge = token.querySelector('.versatility-fit');
    if (token.dataset.versatilityTier === fit.tier && existingBadge) return;
    token.dataset.versatilityTier = fit.tier;
    token.classList.remove('versatility-natural','versatility-comfortable','versatility-cover','versatility-emergency','suitability-warning');
    token.classList.add(`versatility-${fit.tier}`);
    if (fit.tier === 'emergency' || fit.tier === 'unknown') token.classList.add('suitability-warning');
    existingBadge?.remove();
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
  const rows = [...document.querySelectorAll('#squadRows tr:not(.position-separator)')];
  const separators = [...document.querySelectorAll('#squadRows .position-separator')];
  rows.forEach((row) => { row.hidden = false; });
  separators.forEach((row) => { row.hidden = false; });
  if (role === 'all') return;
  rows.forEach((row) => {
    const name = row.querySelector('.player-link')?.textContent?.trim();
    const player = playerByName(name);
    if (!player) return;
    const natural = canonicalRoleFromPosition(positionOf(player));
    const tier = roleSuitability(natural, role).tier;
    row.hidden = !['natural','comfortable','cover'].includes(tier);
  });
  separators.forEach((row) => { row.hidden = true; });
}

function maximumWeightAssignment(weights) {
  const rowCount = weights.length;
  const columnCount = weights[0]?.length || 0;
  if (!rowCount || columnCount < rowCount) return null;
  const u = Array(rowCount + 1).fill(0);
  const v = Array(columnCount + 1).fill(0);
  const p = Array(columnCount + 1).fill(0);
  const way = Array(columnCount + 1).fill(0);
  for (let i = 1; i <= rowCount; i += 1) {
    p[0] = i;
    let j0 = 0;
    const minv = Array(columnCount + 1).fill(Infinity);
    const used = Array(columnCount + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= columnCount; j += 1) {
        if (used[j]) continue;
        const current = -weights[i0 - 1][j - 1] - u[i0] - v[j];
        if (current < minv[j]) {
          minv[j] = current;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= columnCount; j += 1) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0 !== 0);
  }
  const assignment = Array(rowCount).fill(-1);
  for (let j = 1; j <= columnCount; j += 1) {
    if (p[j] > 0 && p[j] <= rowCount) assignment[p[j] - 1] = j - 1;
  }
  return assignment;
}

function selectablePlayerIds() {
  return new Set([...document.querySelectorAll('#formationSquadTray [data-player-id]')]
    .map((node) => String(node.dataset.playerId || ''))
    .filter(Boolean));
}

function autoPickSelection() {
  const formation = document.getElementById('formation')?.value || '4-3-3-wide';
  const roles = FORMATION_ROLES[formation] || FORMATION_ROLES['4-3-3-wide'];
  const allowed = selectablePlayerIds();
  const candidates = (snapshot?.squad || [])
    .filter((player) => allowed.has(String(player.tbg_player_id || player.player_id || '')))
    .map((player) => ({
      player,
      id: String(player.tbg_player_id || player.player_id || ''),
      name: String(player.display_name || player.player_name || player.name || ''),
      rating: ratingOf(player),
      role: canonicalRoleFromPosition(positionOf(player))
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  if (candidates.length < roles.length) return null;
  const hasGoalkeeper = candidates.some((candidate) => candidate.role === 'gk');
  const weights = roles.map((requiredRole) => candidates.map((candidate) => {
    if (requiredRole === 'gk' && hasGoalkeeper && candidate.role !== 'gk') return -10000;
    const fit = roleSuitability(candidate.role, requiredRole);
    return candidate.rating * fit.factor;
  }));
  const assignment = maximumWeightAssignment(weights);
  if (!assignment || assignment.some((index) => index < 0)) return null;
  const startingXi = assignment.map((index) => candidates[index].id);
  const selected = new Set(startingXi);
  const bench = candidates
    .filter((candidate) => !selected.has(candidate.id))
    .sort((a, b) => b.rating - a.rating || a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    .slice(0, 7)
    .map((candidate) => candidate.id);
  return { startingXi, bench };
}

function applyAutoPickToLegacyInputs(selection) {
  const xiContainer = document.getElementById('startingXi');
  const benchContainer = document.getElementById('bench');
  if (!xiContainer || !benchContainer) return false;
  const reorder = (container, orderedIds, selectedIds) => {
    const labels = [...container.querySelectorAll('.player-pick')];
    const byId = new Map(labels.map((label) => [String(label.querySelector('input')?.value || ''), label]));
    labels.forEach((label) => {
      const input = label.querySelector('input');
      if (input) input.checked = selectedIds.has(String(input.value));
    });
    orderedIds.forEach((id) => {
      const label = byId.get(id);
      if (label) container.appendChild(label);
    });
    labels.filter((label) => !orderedIds.includes(String(label.querySelector('input')?.value || '')))
      .forEach((label) => container.appendChild(label));
  };
  reorder(xiContainer, selection.startingXi, new Set(selection.startingXi));
  reorder(benchContainer, selection.bench, new Set(selection.bench));
  document.dispatchEvent(new CustomEvent('tbg:team-sheet-override'));
  xiContainer.querySelector('input:checked')?.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

function interceptAutoPick(event) {
  const button = event.target?.closest?.('#autoPickFormation');
  if (!button || !snapshot?.squad) return;
  const selection = autoPickSelection();
  if (!selection || !applyAutoPickToLegacyInputs(selection)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
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
document.addEventListener('click', interceptAutoPick, true);
document.addEventListener('change', (event) => {
  if (event.target?.id === 'formation') queueMicrotask(apply);
});
new MutationObserver(() => queueMicrotask(apply)).observe(document.documentElement, { childList: true, subtree: true });

window.tbgPositionVersatility = Object.freeze({
  canonicalRoleFromPosition,
  roleSuitability,
  playableRoles,
  autoPickSelection,
  maximumWeightAssignment
});
