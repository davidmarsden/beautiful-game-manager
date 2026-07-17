import { createHash } from 'node:crypto';

const text = (value) => String(value ?? '').trim();
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function hashUnit(seed) {
  const hex = createHash('sha256').update(seed).digest('hex').slice(0, 13);
  return parseInt(hex, 16) / 0x10000000000000;
}

function rating(player) {
  return number(player?.effective_match_rating ?? player?.underlying_ability_rating ?? player?.tbg_rating ?? player?.rating, 75);
}

function playerName(player, fallback = 'A player') {
  return text(player?.display_name || player?.player_name || player?.canonical_name) || fallback;
}

function teamStrength(team, playersById) {
  const ratings = team.starting_xi.map((id) => rating(playersById.get(id)));
  const average = ratings.reduce((sum, value) => sum + value, 0) / ratings.length;
  const tactics = team.tactics || {};
  const mentality = { defensive: -0.12, cautious: -0.06, balanced: 0, positive: 0.06, attacking: 0.12 }[tactics.mentality] || 0;
  const pressing = { low: -0.03, mid: 0, high: 0.04 }[tactics.pressing] || 0;
  const tempo = { slow: -0.02, normal: 0, fast: 0.03 }[tactics.tempo] || 0;
  return { average, attackBias: mentality + pressing + tempo };
}

function poisson(lambda, seed) {
  const limit = Math.exp(-lambda);
  let product = 1;
  let count = 0;
  while (product > limit && count < 12) {
    count += 1;
    product *= Math.max(hashUnit(`${seed}:${count}`), 1e-9);
  }
  return count - 1;
}

function positionText(player) {
  return text(player?.position || player?.primary_position || player?.position_group).toLowerCase();
}

function isGoalkeeper(player) {
  const position = positionText(player);
  return position === 'gk' || position.includes('goalkeeper') || position.includes('keeper');
}

function choosePlayer(team, playersById, seed, role = 'any') {
  const squad = team.starting_xi.map((id, index) => ({ id, index, player: playersById.get(id) }));
  let eligible = squad;

  // Goalkeepers may only be selected for goalkeeper-specific events. This avoids
  // implausible commentary such as a goalkeeper shooting, being offside or leading
  // a normal attack. Fall back to the full XI only for malformed team data.
  if (role === 'keeper') eligible = squad.filter(({ player }) => isGoalkeeper(player));
  else if (role === 'attacker' || role === 'defender') eligible = squad.filter(({ player }) => !isGoalkeeper(player));
  if (!eligible.length) eligible = squad;

  const candidates = eligible.map(({ id, index, player }) => {
    const position = positionText(player);
    let multiplier = 1;
    if (role === 'attacker') multiplier = position.includes('forward') || position.includes('wing') || position.includes('attack') ? 1.55 : position.includes('mid') ? 1.05 : 0.45;
    if (role === 'defender') multiplier = position.includes('back') || position.includes('defen') ? 1.5 : position.includes('mid') ? 1 : 0.55;
    if (role === 'keeper') multiplier = 1;
    return { id, weight: Math.max(1, rating(player) * multiplier), index };
  });
  const total = candidates.reduce((sum, row) => sum + row.weight, 0);
  let cursor = hashUnit(seed) * total;
  for (const row of candidates) {
    cursor -= row.weight;
    if (cursor <= 0) return row.id;
  }
  return candidates.at(-1)?.id || null;
}

function uniqueMinute(runKey, label, index, occupied, min = 1, max = 89) {
  const span = max - min + 1;
  let minute = min + Math.floor(hashUnit(`${runKey}:${label}:minute:${index}`) * span);
  while (occupied.has(minute)) minute = minute >= max ? min : minute + 1;
  occupied.add(minute);
  return minute;
}

function commentaryFor(type, actor, opponent, seed) {
  const variants = {
    goal: [`GOAL! ${actor} finds the net.`, `${actor} finishes the move — GOAL!`, `The crowd erupts as ${actor} scores!`],
    shot_saved: [`${actor} shoots, but ${opponent} makes the save.`, `${actor} tests the goalkeeper. ${opponent} holds on.`, `A sharp effort from ${actor}, pushed away by ${opponent}.`],
    shot_missed: [`${actor} lets fly, but it flashes wide.`, `${actor} is inches away — the effort misses the target.`, `${actor} gets a sight of goal but cannot keep the shot down.`],
    shot_blocked: [`${actor}'s effort is blocked before it can trouble the goalkeeper.`, `${opponent} throws himself in the way of ${actor}'s shot.`, `${actor} pulls the trigger, but the defence closes the door.`],
    corner: [`${actor} wins a corner after sustained pressure.`, `The ball is turned behind. Corner to ${actor}'s side.`, `${actor} forces the defence to concede a corner.`],
    foul: [`A late challenge on ${actor}. The referee gives the free kick.`, `${opponent} clips ${actor} and the whistle goes.`, `${actor} is brought down as the attack gathers pace.`],
    yellow_card: [`YELLOW CARD — ${actor} goes into the book.`, `${actor} is cautioned after a mistimed challenge.`, `No argument from ${actor}; the referee shows yellow.`],
    red_card: [`RED CARD — ${actor} is sent off!`, `${actor} sees red and the match changes completely.`, `The referee reaches for the red card. ${actor} is dismissed.`],
    offside: [`${actor} goes too early. The flag is up.`, `${actor} is caught offside as the defence steps out.`, `A promising move ends with ${actor} beyond the last defender.`],
    tackle: [`Excellent tackle by ${actor} to stop the attack.`, `${actor} reads the danger and wins the ball cleanly.`, `${actor} times the challenge perfectly.`],
    dangerous_attack: [`${actor} drives forward and the defence retreats.`, `${actor}'s side are building pressure around the penalty area.`, `A dangerous move develops through ${actor}.`],
    crowd: [`The crowd sense an opening and raise the noise.`, `A restless murmur rolls around the ground.`, `The home support roar their side forward.`],
    quiet_spell: [`A patient spell with neither side able to find a way through.`, `The tempo drops as both teams reorganise.`, `A cagey passage of play in midfield.`],
    half_time: [`HALF TIME — the players head for the dressing rooms.`],
    full_time: [`FULL TIME — the referee brings the match to an end.`]
  };
  const options = variants[type] || [`${String(type).replaceAll('_', ' ').toUpperCase()} — ${actor}`];
  return options[Math.floor(hashUnit(seed) * options.length) % options.length];
}

function makeEvent({ runKey, type, side, minute, index, playerId = null, opponentId = null, playersById, extra = {} }) {
  const actor = playerName(playersById.get(playerId));
  const opponent = playerName(playersById.get(opponentId), 'the opponent');
  return {
    event_id: `${runKey}:${type}:${side || 'neutral'}:${index + 1}`,
    type,
    side: side || 'neutral',
    minute,
    player_id: playerId,
    assist_player_id: extra.assist_player_id || null,
    commentary: commentaryFor(type, actor, opponent, `${runKey}:${type}:copy:${index}`),
    ...extra
  };
}

function buildRichEvents({ contract, playersById, homeGoals, awayGoals, homeShots, awayShots }) {
  const occupied = new Set([45, 90]);
  const events = [];
  const teams = contract.teams;
  const add = (type, side, index, role = 'attacker', opponentRole = 'defender', min = 1, max = 89, extra = {}) => {
    const team = teams[side];
    const otherSide = side === 'home' ? 'away' : 'home';
    const minute = uniqueMinute(contract.run_key, `${side}:${type}`, index, occupied, min, max);
    const playerId = choosePlayer(team, playersById, `${contract.run_key}:${side}:${type}:player:${index}`, role);
    const opponentId = choosePlayer(teams[otherSide], playersById, `${contract.run_key}:${side}:${type}:opponent:${index}`, opponentRole);
    events.push(makeEvent({ runKey: contract.run_key, type, side, minute, index, playerId, opponentId, playersById, extra }));
  };

  for (const [side, goals] of [['home', homeGoals], ['away', awayGoals]]) {
    for (let index = 0; index < goals; index += 1) add('goal', side, index, 'attacker', 'keeper');
  }

  const savedHome = Math.max(1, Math.min(5, Math.round((homeShots - homeGoals) * 0.35)));
  const savedAway = Math.max(1, Math.min(5, Math.round((awayShots - awayGoals) * 0.35)));
  const missedHome = Math.max(2, Math.min(6, Math.round((homeShots - homeGoals) * 0.38)));
  const missedAway = Math.max(2, Math.min(6, Math.round((awayShots - awayGoals) * 0.38)));
  for (let i = 0; i < savedHome; i += 1) add('shot_saved', 'home', i, 'attacker', 'keeper');
  for (let i = 0; i < savedAway; i += 1) add('shot_saved', 'away', i, 'attacker', 'keeper');
  for (let i = 0; i < missedHome; i += 1) add(i % 3 === 0 ? 'shot_blocked' : 'shot_missed', 'home', i, 'attacker', 'defender');
  for (let i = 0; i < missedAway; i += 1) add(i % 3 === 0 ? 'shot_blocked' : 'shot_missed', 'away', i, 'attacker', 'defender');
  for (let i = 0; i < 3; i += 1) add('dangerous_attack', i % 2 ? 'away' : 'home', i, 'attacker', 'defender');
  for (let i = 0; i < 4; i += 1) add('tackle', i % 2 ? 'home' : 'away', i, 'defender', 'attacker');
  for (let i = 0; i < 3; i += 1) add('foul', i % 2 ? 'away' : 'home', i, 'attacker', 'defender');
  for (let i = 0; i < 2; i += 1) add('corner', i % 2 ? 'away' : 'home', i, 'attacker', 'defender');
  for (let i = 0; i < 2; i += 1) add('offside', i % 2 ? 'home' : 'away', i, 'attacker', 'defender');
  add('yellow_card', hashUnit(`${contract.run_key}:card:side`) > 0.5 ? 'home' : 'away', 0, 'defender', 'attacker', 20, 85);

  const crowdMinutes = [8, 34, 67];
  crowdMinutes.forEach((minute, index) => {
    if (occupied.has(minute)) return;
    occupied.add(minute);
    const type = index === 1 ? 'quiet_spell' : 'crowd';
    events.push(makeEvent({ runKey: contract.run_key, type, side: 'neutral', minute, index, playersById }));
  });
  events.push(makeEvent({ runKey: contract.run_key, type: 'half_time', side: 'neutral', minute: 45, index: 0, playersById }));
  events.push(makeEvent({ runKey: contract.run_key, type: 'full_time', side: 'neutral', minute: 90, index: 0, playersById }));
  return events.sort((a, b) => a.minute - b.minute || a.event_id.localeCompare(b.event_id));
}

export function simulateMatch(contract, world) {
  if (!contract?.fixture || !contract?.teams?.home || !contract?.teams?.away) throw new Error('A complete engine contract is required');
  const playersById = new Map((world?.players || []).map((player) => [text(player.tbg_player_id), player]));
  const homeStrength = teamStrength(contract.teams.home, playersById);
  const awayStrength = teamStrength(contract.teams.away, playersById);
  const qualityGap = clamp((homeStrength.average - awayStrength.average) / 14, -1.2, 1.2);
  const homeLambda = clamp(1.38 + 0.22 + qualityGap * 0.55 + homeStrength.attackBias - awayStrength.attackBias * 0.35, 0.25, 4.2);
  const awayLambda = clamp(1.18 - qualityGap * 0.55 + awayStrength.attackBias - homeStrength.attackBias * 0.35, 0.2, 4.0);
  const homeGoals = poisson(homeLambda, `${contract.run_key}:home`);
  const awayGoals = poisson(awayLambda, `${contract.run_key}:away`);
  const homeShots = Math.max(homeGoals, Math.round(7 + homeLambda * 3 + hashUnit(`${contract.run_key}:home:shots`) * 5));
  const awayShots = Math.max(awayGoals, Math.round(6 + awayLambda * 3 + hashUnit(`${contract.run_key}:away:shots`) * 5));
  const possessionHome = clamp(Math.round(50 + qualityGap * 8 + (hashUnit(`${contract.run_key}:possession`) - 0.5) * 8), 32, 68);
  const events = buildRichEvents({ contract, playersById, homeGoals, awayGoals, homeShots, awayShots });

  return {
    result_version: '2d5-v1',
    run_key: contract.run_key,
    fixture_id: contract.fixture.fixture_id,
    status: 'completed',
    played_at: new Date().toISOString(),
    score: { home: homeGoals, away: awayGoals },
    outcome: homeGoals > awayGoals ? 'home_win' : awayGoals > homeGoals ? 'away_win' : 'draw',
    events,
    statistics: {
      home: { shots: homeShots, shots_on_target: Math.min(homeShots, Math.max(homeGoals, Math.round(homeShots * 0.42))), possession: possessionHome },
      away: { shots: awayShots, shots_on_target: Math.min(awayShots, Math.max(awayGoals, Math.round(awayShots * 0.42))), possession: 100 - possessionHome }
    },
    model: {
      simulator: 'tbg-deterministic-bootstrap-rich-events',
      note: 'Phase 2D.5 text-first event stream; replaceable by the constitutional engine without changing the Match Centre contract.'
    }
  };
}
