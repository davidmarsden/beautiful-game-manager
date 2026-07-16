import { createHash } from 'node:crypto';

const text = (value) => String(value ?? '').trim();
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function hashUnit(seed) {
  // Thirteen hexadecimal digits contain 52 bits. Divide by the matching
  // 52-bit range so the deterministic value spans [0, 1) without a 0.5 bias.
  const hex = createHash('sha256').update(seed).digest('hex').slice(0, 13);
  return parseInt(hex, 16) / 0x10000000000000;
}

function rating(player) {
  return number(player?.effective_match_rating ?? player?.underlying_ability_rating ?? player?.tbg_rating ?? player?.rating, 75);
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

function chooseScorer(team, playersById, seed) {
  const candidates = team.starting_xi.map((id, index) => {
    const player = playersById.get(id);
    const position = text(player?.position || player?.primary_position || player?.position_group).toLowerCase();
    const weight = rating(player) * (position.includes('forward') || position.includes('wing') || position.includes('attack') ? 1.45 : position.includes('mid') ? 1.05 : 0.55);
    return { id, weight, index };
  });
  const total = candidates.reduce((sum, row) => sum + row.weight, 0);
  let cursor = hashUnit(seed) * total;
  for (const row of candidates) {
    cursor -= row.weight;
    if (cursor <= 0) return row.id;
  }
  return candidates.at(-1)?.id || null;
}

function eventsForGoals(side, goals, team, playersById, runKey) {
  const minutes = [];
  for (let index = 0; index < goals; index += 1) {
    let minute = 1 + Math.floor(hashUnit(`${runKey}:${side}:minute:${index}`) * 90);
    while (minutes.includes(minute)) minute = minute === 90 ? 1 : minute + 1;
    minutes.push(minute);
  }
  return minutes.sort((a, b) => a - b).map((minute, index) => ({
    event_id: `${runKey}:${side}:goal:${index + 1}`,
    type: 'goal',
    side,
    minute,
    player_id: chooseScorer(team, playersById, `${runKey}:${side}:scorer:${index}`),
    assist_player_id: null
  }));
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
  const events = [
    ...eventsForGoals('home', homeGoals, contract.teams.home, playersById, contract.run_key),
    ...eventsForGoals('away', awayGoals, contract.teams.away, playersById, contract.run_key)
  ].sort((a, b) => a.minute - b.minute || a.side.localeCompare(b.side));

  const homeShots = Math.max(homeGoals, Math.round(7 + homeLambda * 3 + hashUnit(`${contract.run_key}:home:shots`) * 5));
  const awayShots = Math.max(awayGoals, Math.round(6 + awayLambda * 3 + hashUnit(`${contract.run_key}:away:shots`) * 5));
  const possessionHome = clamp(Math.round(50 + qualityGap * 8 + (hashUnit(`${contract.run_key}:possession`) - 0.5) * 8), 32, 68);

  return {
    result_version: '2d2-v1',
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
      simulator: 'tbg-deterministic-bootstrap',
      note: 'Phase 2D.2 persistence-capable simulator; replaceable by the full constitutional match engine without changing the result contract.'
    }
  };
}
