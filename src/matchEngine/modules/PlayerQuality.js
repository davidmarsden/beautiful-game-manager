const text = (value) => String(value ?? '').trim().toLowerCase();
const number = (value, fallback = null) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const round = (value, places = 4) => Number(Number(value).toFixed(places));

export const PLAYER_QUALITY_VERSION = 'tbg-player-quality-v0.1';
export const PLAYER_QUALITY_STATE_KEY = 'module_b_player_quality';

const FORMATION_SLOTS = Object.freeze({
  '4-4-2': Object.freeze(['gk','fb','cb','cb','fb','wide_mid','cm','cm','wide_mid','st','st']),
  '4-3-3-wide': Object.freeze(['gk','fb','cb','cb','fb','dm','cm','cm','wing','st','wing']),
  '4-2-3-1': Object.freeze(['gk','fb','cb','cb','fb','dm','dm','wing','am','wing','st']),
  '4-1-4-1': Object.freeze(['gk','fb','cb','cb','fb','dm','wide_mid','cm','cm','wide_mid','st']),
  '3-5-2': Object.freeze(['gk','cb','cb','cb','wing_back','cm','dm','cm','wing_back','st','st']),
  '3-4-3': Object.freeze(['gk','cb','cb','cb','wing_back','cm','cm','wing_back','wing','st','wing']),
  '5-3-2': Object.freeze(['gk','wing_back','cb','cb','cb','wing_back','dm','cm','cm','st','st'])
});

const UNIT_FOR_SLOT = Object.freeze({
  gk: 'goalkeeping', fb: 'defence', cb: 'defence', wing_back: 'defence',
  dm: 'midfield', cm: 'midfield', am: 'midfield', wide_mid: 'midfield',
  wing: 'attack', st: 'attack'
});

const POSITION_GROUPS = Object.freeze({
  gk: new Set(['gk','goalkeeper']),
  cb: new Set(['cb','centre back','center back','centre-back','center-back','defender']),
  fb: new Set(['rb','lb','right back','left back','right-back','left-back','full back','full-back']),
  wing_back: new Set(['rwb','lwb','right wing-back','left wing-back','wing back','wing-back']),
  dm: new Set(['dm','defensive midfield','defensive midfielder','holding midfield']),
  cm: new Set(['cm','central midfield','central midfielder','midfielder']),
  am: new Set(['am','attacking midfield','attacking midfielder','number 10']),
  wide_mid: new Set(['rm','lm','right midfield','left midfield','wide midfield']),
  wing: new Set(['rw','lw','right winger','left winger','winger','wide forward']),
  st: new Set(['st','cf','striker','centre forward','center forward','centre-forward','center-forward','forward','attacker'])
});

const ADJACENT = Object.freeze({
  cb: new Set(['fb','wing_back','dm']),
  fb: new Set(['cb','wing_back','wide_mid']),
  wing_back: new Set(['fb','wide_mid','wing']),
  dm: new Set(['cb','cm']),
  cm: new Set(['dm','am','wide_mid']),
  am: new Set(['cm','wing','st']),
  wide_mid: new Set(['fb','wing_back','cm','wing']),
  wing: new Set(['wide_mid','am','st','wing_back']),
  st: new Set(['am','wing'])
});

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function playerPosition(player = {}) {
  return text(
    player.position
    || player.primary_position
    || player.position_name
    || player.position_detail
    || player.canonical_position
    || player.transfermarkt_position
    || player.position_group
  );
}

function canonicalRole(player = {}) {
  const position = playerPosition(player);
  for (const [role, values] of Object.entries(POSITION_GROUPS)) {
    if (values.has(position)) return role;
  }
  if (position.includes('goal')) return 'gk';
  if (position.includes('back')) return position.includes('wing') ? 'wing_back' : position.includes('centre') || position.includes('center') ? 'cb' : 'fb';
  if (position.includes('defensive')) return 'dm';
  if (position.includes('attacking')) return 'am';
  if (position.includes('wing')) return 'wing';
  if (position.includes('mid')) return 'cm';
  if (position.includes('forward') || position.includes('striker')) return 'st';
  return 'unknown';
}

export function playerAbility(player = {}) {
  const rating = number(
    player.underlying_ability_rating
    ?? player.ability
    ?? player.current_ability
    ?? player.ability_rating
    ?? player.rating,
    null
  );
  if (rating === null) throw new Error(`Module B player is missing Ability: ${player.tbg_player_id || player.id || 'unknown'}`);
  return clamp(rating, 1, 100);
}

function playerForm(player = {}) {
  return clamp(number(player.form ?? player.form_rating ?? player.current_form, 0), -5, 5);
}

export function roleSuitability(player, requiredRole) {
  const actualRole = canonicalRole(player);
  if (actualRole === requiredRole) return 1;
  if (requiredRole === 'gk' || actualRole === 'gk') return 0.72;
  if (ADJACENT[requiredRole]?.has(actualRole) || ADJACENT[actualRole]?.has(requiredRole)) return 0.96;
  if (UNIT_FOR_SLOT[requiredRole] === UNIT_FOR_SLOT[actualRole]) return 0.91;
  if (actualRole === 'unknown') return 0.88;
  return 0.84;
}

export function resolvePlayerQuality(player, requiredRole, slotIndex) {
  const ability = playerAbility(player);
  const form = playerForm(player);
  const suitability = roleSuitability(player, requiredRole);
  const formAdjustment = form * 0.6;
  const effective = clamp((ability + formAdjustment) * suitability, 1, 100);

  return deepFreeze({
    player_id: String(player.tbg_player_id || player.id || ''),
    display_name: player.display_name || player.name || null,
    slot_index: slotIndex,
    required_role: requiredRole,
    actual_role: canonicalRole(player),
    ability: round(ability, 2),
    form: round(form, 2),
    form_adjustment: round(formAdjustment, 2),
    role_suitability: round(suitability, 3),
    effective_quality: round(effective, 3)
  });
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function resolveBench(players) {
  const ranked = players
    .map((player) => ({ player_id: String(player.tbg_player_id || player.id || ''), ability: playerAbility(player), form: playerForm(player) }))
    .map((row) => ({ ...row, effective_quality: clamp(row.ability + row.form * 0.4, 1, 100) }))
    .sort((left, right) => right.effective_quality - left.effective_quality);
  const usefulDepth = ranked.slice(0, 5);
  return deepFreeze({
    players: usefulDepth.map((row) => ({ ...row, effective_quality: round(row.effective_quality, 3) })),
    depth_quality: round(average(usefulDepth.map((row) => row.effective_quality)), 3),
    depth_count: usefulDepth.length
  });
}

export function resolveTeamQuality(team, playersById) {
  const formation = text(team?.formation) || '4-3-3-wide';
  const slots = FORMATION_SLOTS[formation];
  if (!slots) throw new Error(`Unsupported Module B formation: ${formation}`);
  const startingIds = Array.isArray(team?.starting_xi) ? team.starting_xi.map(String) : [];
  if (startingIds.length !== 11) throw new Error(`Module B starting XI must contain 11 players; received ${startingIds.length}`);

  const starters = startingIds.map((playerId, index) => {
    const player = playersById.get(playerId);
    if (!player) throw new Error(`Module B player not found: ${playerId}`);
    return resolvePlayerQuality(player, slots[index], index);
  });

  const units = {};
  for (const unit of ['goalkeeping','defence','midfield','attack']) {
    const members = starters.filter((player) => UNIT_FOR_SLOT[player.required_role] === unit);
    units[unit] = deepFreeze({
      player_count: members.length,
      raw_ability: round(average(members.map((player) => player.ability)), 3),
      effective_quality: round(average(members.map((player) => player.effective_quality)), 3)
    });
  }

  const benchPlayers = (team?.bench || []).map((playerId) => {
    const player = playersById.get(String(playerId));
    if (!player) throw new Error(`Module B bench player not found: ${playerId}`);
    return player;
  });
  const bench = resolveBench(benchPlayers);
  const xiQuality = average(starters.map((player) => player.effective_quality));
  const depthContribution = bench.depth_count ? (bench.depth_quality - xiQuality) * 0.15 : 0;
  const teamStrength = clamp(xiQuality + depthContribution, 1, 100);

  return deepFreeze({
    version: PLAYER_QUALITY_VERSION,
    side: text(team?.side),
    club_id: String(team?.club_id ?? '').trim() || null,
    formation,
    starters,
    units,
    bench,
    starting_xi_quality: round(xiQuality, 3),
    depth_contribution: round(depthContribution, 3),
    team_strength: round(teamStrength, 3),
    rating_inputs: deepFreeze({
      ability: 'primary',
      form: 'bounded temporary adjustment',
      potential: 'excluded from match quality',
      reputation: 'excluded from match quality'
    })
  });
}

export function executePlayerQuality(context) {
  const result = deepFreeze({
    version: PLAYER_QUALITY_VERSION,
    home: resolveTeamQuality(context.teams.home, context.playersById),
    away: resolveTeamQuality(context.teams.away, context.playersById),
    applied_to_public_result: false
  });
  context.set(PLAYER_QUALITY_STATE_KEY, result);
  return context;
}

export const MODULE_B_FORMATION_SLOTS = FORMATION_SLOTS;
