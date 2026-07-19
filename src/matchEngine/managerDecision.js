const text = (value) => String(value ?? '').trim();
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export const MANAGER_DECISION_VERSION = 'tbg-manager-decision-v1.0';

const FORMATIONS = Object.freeze({
  '4-3-3-wide': Object.freeze({ goalkeeper: 1, defender: 4, midfielder: 3, attacker: 3 }),
  '4-2-3-1': Object.freeze({ goalkeeper: 1, defender: 4, midfielder: 5, attacker: 1 }),
  '4-4-2': Object.freeze({ goalkeeper: 1, defender: 4, midfielder: 4, attacker: 2 })
});

function positionGroup(player) {
  const position = text(player?.position || player?.primary_position || player?.position_group).toLowerCase();
  if (position.includes('goalkeeper') || position === 'gk' || position.includes('keeper')) return 'goalkeeper';
  if (position.includes('back') || position.includes('defen')) return 'defender';
  if (position.includes('forward') || position.includes('striker') || position.includes('wing')) return 'attacker';
  return 'midfielder';
}

function playerId(player) {
  return text(player?.tbg_player_id || player?.player_id || player?.id);
}

function rating(player) {
  return number(player?.effective_match_rating ?? player?.underlying_ability_rating ?? player?.tbg_rating ?? player?.rating, 75);
}

function scorePlayer(player, playerState, previousStartingXi, policy) {
  const id = playerId(player);
  const fitness = clamp(number(playerState?.fitness, 100), 0, 100);
  const sharpness = clamp(number(playerState?.sharpness, 100), 0, 100);
  const continuity = previousStartingXi?.includes(id) ? policy.continuity_weight : 0;
  const fatiguePenalty = Math.max(0, policy.rotation_fitness_threshold - fitness) * policy.fatigue_penalty_per_point;
  return rating(player) + fitness * policy.fitness_weight + sharpness * policy.sharpness_weight + continuity - fatiguePenalty;
}

function chooseFormation(club, eligible, policy) {
  const preferred = text(club?.formation);
  const candidates = [preferred, ...(policy.allowed_formations || [])].filter((value, index, rows) => FORMATIONS[value] && rows.indexOf(value) === index);
  for (const formation of candidates) {
    const shape = FORMATIONS[formation];
    const counts = Object.fromEntries(Object.keys(shape).map((group) => [group, eligible.filter((player) => positionGroup(player) === group).length]));
    if (Object.entries(shape).every(([group, required]) => counts[group] >= required)) return formation;
  }
  throw new Error(`No viable formation for ${text(club?.club_id) || 'club'}`);
}

function selectByShape(eligible, formation, state, previousStartingXi, policy) {
  const shape = FORMATIONS[formation];
  const selected = [];
  for (const [group, required] of Object.entries(shape)) {
    const candidates = eligible
      .filter((player) => positionGroup(player) === group)
      .sort((left, right) => scorePlayer(right, state[playerId(right)], previousStartingXi, policy)
        - scorePlayer(left, state[playerId(left)], previousStartingXi, policy)
        || playerId(left).localeCompare(playerId(right)));
    if (candidates.length < required) throw new Error(`Not enough eligible ${group}s for ${formation}`);
    selected.push(...candidates.slice(0, required));
  }
  return selected;
}

function tacticalPlan({ club, opponent, side, starters, playerState, policy }) {
  const ownAverage = starters.reduce((sum, player) => sum + rating(player), 0) / starters.length;
  const opponentAverage = number(opponent?.average_rating, ownAverage);
  const fitnessAverage = starters.reduce((sum, player) => sum + number(playerState[playerId(player)]?.fitness, 100), 0) / starters.length;
  const gap = ownAverage - opponentAverage;
  const base = { ...(club?.tactics || {}) };
  const mentality = gap >= policy.positive_gap ? 'positive' : gap <= -policy.cautious_gap ? 'cautious' : (base.mentality || 'balanced');
  const pressing = fitnessAverage < policy.low_fitness_pressing_threshold ? 'low' : (gap < -policy.cautious_gap ? 'mid' : (base.pressing || 'mid'));
  const tempo = fitnessAverage < policy.low_fitness_tempo_threshold ? 'slow' : (base.tempo || 'normal');
  return Object.freeze({
    ...base,
    mentality,
    pressing,
    tempo,
    home_instruction: side === 'home' && mentality === 'balanced' ? 'controlled_front_foot' : null
  });
}

export const DEFAULT_MANAGER_POLICY = Object.freeze({
  allowed_formations: Object.freeze(['4-3-3-wide', '4-2-3-1', '4-4-2']),
  rotation_fitness_threshold: 82,
  fitness_weight: 0.045,
  sharpness_weight: 0.015,
  continuity_weight: 0.8,
  fatigue_penalty_per_point: 0.22,
  positive_gap: 2.5,
  cautious_gap: 2.5,
  low_fitness_pressing_threshold: 84,
  low_fitness_tempo_threshold: 80
});

export function makeManagerDecision({ club, opponent = {}, side = 'home', matchday = 1, playerState = {}, availability, previousStartingXi = null, policy = DEFAULT_MANAGER_POLICY } = {}) {
  if (!club || !Array.isArray(club.players)) throw new Error('Manager decision requires a club squad');
  const eligible = club.players.filter((player) => {
    const id = playerId(player);
    if (!id) return false;
    return availability ? availability(id, matchday) : true;
  });
  if (eligible.length < 11) throw new Error(`Manager decision found only ${eligible.length} eligible players for ${text(club.club_id) || 'club'}`);
  const formation = chooseFormation(club, eligible, policy);
  const starters = selectByShape(eligible, formation, playerState, previousStartingXi, policy);
  const starterIds = starters.map(playerId);
  const bench = eligible
    .filter((player) => !starterIds.includes(playerId(player)))
    .sort((left, right) => scorePlayer(right, playerState[playerId(right)], previousStartingXi, policy)
      - scorePlayer(left, playerState[playerId(left)], previousStartingXi, policy)
      || playerId(left).localeCompare(playerId(right)))
    .slice(0, 7)
    .map(playerId);
  const rotatedOut = (previousStartingXi || []).filter((id) => !starterIds.includes(id));
  const tactics = tacticalPlan({ club, opponent, side, starters, playerState, policy });
  return Object.freeze({
    version: MANAGER_DECISION_VERSION,
    club_id: text(club.club_id),
    matchday,
    formation,
    starting_xi: Object.freeze(starterIds),
    bench: Object.freeze(bench),
    tactics,
    decision: Object.freeze({
      eligible_count: eligible.length,
      rotated_out: Object.freeze(rotatedOut),
      rotation_count: rotatedOut.length,
      average_starting_rating: Number((starters.reduce((sum, player) => sum + rating(player), 0) / starters.length).toFixed(3))
    })
  });
}
