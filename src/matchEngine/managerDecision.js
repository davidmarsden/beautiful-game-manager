const text = (value) => String(value ?? '').trim();
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export const MANAGER_DECISION_VERSION = 'tbg-manager-decision-v1.3';

const FORMATIONS = Object.freeze({
  '4-3-3-wide': Object.freeze({ goalkeeper: 1, defender: 4, midfielder: 3, attacker: 3 }),
  '4-2-3-1': Object.freeze({ goalkeeper: 1, defender: 4, midfielder: 5, attacker: 1 }),
  '4-4-2': Object.freeze({ goalkeeper: 1, defender: 4, midfielder: 4, attacker: 2 }),
  '4-1-4-1': Object.freeze({ goalkeeper: 1, defender: 4, midfielder: 5, attacker: 1 }),
  '3-5-2': Object.freeze({ goalkeeper: 1, defender: 3, midfielder: 5, attacker: 2 }),
  '3-4-3': Object.freeze({ goalkeeper: 1, defender: 3, midfielder: 4, attacker: 3 }),
  '5-3-2': Object.freeze({ goalkeeper: 1, defender: 5, midfielder: 3, attacker: 2 })
});

function positionGroup(player) {
  const position = text(player?.position || player?.primary_position || player?.position_group).toLowerCase();
  if (position.includes('goalkeeper') || position === 'gk' || position.includes('keeper')) return 'goalkeeper';
  if (position.includes('midfield') || position === 'dm' || position === 'cm' || position === 'am') return 'midfielder';
  if (position.includes('back') || position.includes('centre-back') || position.includes('center-back') || position === 'cb' || position === 'lb' || position === 'rb' || position.includes('defender')) return 'defender';
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

function chooseFormation(club, policy) {
  const preferred = text(club?.formation);
  if (FORMATIONS[preferred]) return preferred;
  const fallback = (policy.allowed_formations || []).find((formation) => FORMATIONS[formation]);
  if (!fallback) throw new Error(`No supported formation for ${text(club?.club_id) || 'club'}`);
  return fallback;
}

function compatibilityPenalty(player, targetGroup, policy) {
  const sourceGroup = positionGroup(player);
  if (sourceGroup === targetGroup) return 0;
  if (sourceGroup === 'goalkeeper' || targetGroup === 'goalkeeper') return Number.POSITIVE_INFINITY;
  return number(policy.out_of_position_penalties?.[`${sourceGroup}:${targetGroup}`], policy.emergency_outfield_penalty);
}

function emergencyPosition(group) {
  if (group === 'goalkeeper') return 'Goalkeeper';
  if (group === 'defender') return 'Centre-Back';
  if (group === 'attacker') return 'Centre-Forward';
  return 'Central Midfield';
}

function emergencyYouth(club, matchday, group, index, policy) {
  const clubId = text(club?.club_id) || 'club';
  const id = `${clubId}-emergency-youth-${group}-md${matchday}-${index + 1}`;
  return Object.freeze({
    tbg_player_id: id,
    display_name: `${text(club?.club_name) || clubId} Emergency Youth ${index + 1}`,
    position: emergencyPosition(group),
    underlying_ability_rating: policy.emergency_youth_rating,
    work_rate: 60,
    temporary_emergency_callup: true,
    emergency_matchday: matchday
  });
}

function buildSelectionPool(club, eligibleSeniors, formation, matchday, policy) {
  const pool = [...eligibleSeniors];
  const emergencyPlayers = [];
  const shape = FORMATIONS[formation];
  const goalkeeperCount = pool.filter((player) => positionGroup(player) === 'goalkeeper').length;
  const outfieldCount = pool.filter((player) => positionGroup(player) !== 'goalkeeper').length;

  if (goalkeeperCount < 1) {
    const player = emergencyYouth(club, matchday, 'goalkeeper', emergencyPlayers.length, policy);
    emergencyPlayers.push(player);
    pool.push(player);
  }

  let missingOutfield = Math.max(0, 10 - outfieldCount);
  const groups = ['defender', 'midfielder', 'attacker'];
  while (missingOutfield > 0) {
    const group = groups
      .map((name) => ({ name, shortage: Math.max(0, shape[name] - pool.filter((player) => positionGroup(player) === name).length) }))
      .sort((left, right) => right.shortage - left.shortage || groups.indexOf(left.name) - groups.indexOf(right.name))[0].name;
    const player = emergencyYouth(club, matchday, group, emergencyPlayers.length, policy);
    emergencyPlayers.push(player);
    pool.push(player);
    missingOutfield -= 1;
  }

  return { pool, emergencyPlayers };
}

function selectByShape(pool, formation, state, previousStartingXi, policy) {
  const shape = FORMATIONS[formation];
  const selected = [];
  const assignments = [];
  const groupOrder = ['goalkeeper', 'defender', 'midfielder', 'attacker'];

  for (const group of groupOrder) {
    const required = shape[group];
    for (let slot = 0; slot < required; slot += 1) {
      const candidates = pool
        .filter((player) => !selected.includes(player))
        .map((player) => ({
          player,
          penalty: compatibilityPenalty(player, group, policy)
        }))
        .filter((candidate) => Number.isFinite(candidate.penalty))
        .sort((left, right) => (
          (scorePlayer(right.player, state[playerId(right.player)], previousStartingXi, policy) - right.penalty)
          - (scorePlayer(left.player, state[playerId(left.player)], previousStartingXi, policy) - left.penalty)
          || playerId(left.player).localeCompare(playerId(right.player))
        ));
      if (!candidates.length) throw new Error(`Unable to fill ${group} slot for ${formation}`);
      const choice = candidates[0];
      selected.push(choice.player);
      assignments.push(Object.freeze({
        player_id: playerId(choice.player),
        natural_group: positionGroup(choice.player),
        selected_group: group,
        out_of_position: choice.penalty > 0,
        penalty: choice.penalty
      }));
    }
  }

  return { selected, assignments };
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

function isAvailable(result) {
  if (typeof result === 'boolean') return result;
  return Boolean(result?.available);
}

export const DEFAULT_MANAGER_POLICY = Object.freeze({
  allowed_formations: Object.freeze(['4-3-3-wide', '4-2-3-1', '4-4-2', '4-1-4-1', '3-5-2', '3-4-3', '5-3-2']),
  rotation_fitness_threshold: 82,
  fitness_weight: 0.045,
  sharpness_weight: 0.015,
  continuity_weight: 0.8,
  fatigue_penalty_per_point: 0.22,
  positive_gap: 2.5,
  cautious_gap: 2.5,
  low_fitness_pressing_threshold: 84,
  low_fitness_tempo_threshold: 80,
  emergency_youth_rating: 68,
  emergency_outfield_penalty: 12,
  out_of_position_penalties: Object.freeze({
    'midfielder:defender': 4,
    'defender:midfielder': 6,
    'attacker:midfielder': 5,
    'midfielder:attacker': 6,
    'attacker:defender': 10,
    'defender:attacker': 10
  })
});

export function makeManagerDecision({ club, opponent = {}, side = 'home', matchday = 1, playerState = {}, availability, previousStartingXi = null, policy = DEFAULT_MANAGER_POLICY } = {}) {
  if (!club || !Array.isArray(club.players)) throw new Error('Manager decision requires a club squad');
  const eligibleSeniors = club.players.filter((player) => {
    const id = playerId(player);
    if (!id) return false;
    return availability ? isAvailable(availability(id, matchday)) : true;
  });
  const formation = chooseFormation(club, policy);
  const { pool, emergencyPlayers } = buildSelectionPool(club, eligibleSeniors, formation, matchday, policy);
  const { selected: starters, assignments } = selectByShape(pool, formation, playerState, previousStartingXi, policy);
  const starterIds = starters.map(playerId);
  const bench = pool
    .filter((player) => !starterIds.includes(playerId(player)))
    .sort((left, right) => scorePlayer(right, playerState[playerId(right)], previousStartingXi, policy)
      - scorePlayer(left, playerState[playerId(left)], previousStartingXi, policy)
      || playerId(left).localeCompare(playerId(right)))
    .slice(0, 7)
    .map(playerId);
  const rotatedOut = (previousStartingXi || []).filter((id) => !starterIds.includes(id));
  const tactics = tacticalPlan({ club, opponent, side, starters, playerState, policy });
  const outOfPosition = assignments.filter((row) => row.out_of_position);
  return Object.freeze({
    version: MANAGER_DECISION_VERSION,
    club_id: text(club.club_id),
    matchday,
    formation,
    starting_xi: Object.freeze(starterIds),
    bench: Object.freeze(bench),
    tactics,
    emergency_players: Object.freeze(emergencyPlayers),
    decision: Object.freeze({
      eligible_count: eligibleSeniors.length,
      rotated_out: Object.freeze(rotatedOut),
      rotation_count: rotatedOut.length,
      average_starting_rating: Number((starters.reduce((sum, player) => sum + rating(player), 0) / starters.length).toFixed(3)),
      out_of_position_count: outOfPosition.length,
      out_of_position: Object.freeze(outOfPosition),
      emergency_youth_count: emergencyPlayers.length,
      emergency_youth: Object.freeze(emergencyPlayers.map(playerId)),
      assignments: Object.freeze(assignments)
    })
  });
}
