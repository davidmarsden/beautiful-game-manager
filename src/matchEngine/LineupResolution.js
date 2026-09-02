const text = (value) => String(value ?? '').trim();
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

const MAXIMUM_SUBSTITUTIONS = 5;
const EVENT_PRIORITY = Object.freeze({ injury: 9, red_card: 8, yellow_card: 7, substitution: 6, goal: 5, penalty: 4, foul: 3, set_piece: 2, big_chance: 1, shot: 0 });
const ROLE_UNIT = Object.freeze({
  gk: 'goalkeeping', cb: 'defence', fb: 'defence', wing_back: 'defence',
  dm: 'midfield', cm: 'midfield', am: 'midfield', wide_mid: 'midfield',
  wing: 'attack', st: 'attack'
});
const ROLE_ADJACENT = Object.freeze({
  cb: new Set(['fb', 'wing_back', 'dm']),
  fb: new Set(['cb', 'wing_back', 'wide_mid']),
  wing_back: new Set(['fb', 'wide_mid', 'wing']),
  dm: new Set(['cb', 'cm']),
  cm: new Set(['dm', 'am', 'wide_mid']),
  am: new Set(['cm', 'wing', 'st']),
  wide_mid: new Set(['fb', 'wing_back', 'cm', 'wing']),
  wing: new Set(['wide_mid', 'am', 'st', 'wing_back']),
  st: new Set(['am', 'wing'])
});
const ASSIST_ROLE_WEIGHT = Object.freeze({
  am: 1.35, wing: 1.30, wide_mid: 1.18, cm: 1.12, st: 1.00,
  wing_back: 0.88, fb: 0.82, dm: 0.78, cb: 0.58, unknown: 0.72
});
const ASSISTED_OPEN_PLAY_SHARE = 0.74;

function stableUnit(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967296;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function orderEvents(events) {
  return events.sort((left, right) => left.minute - right.minute || (EVENT_PRIORITY[right.type] || 0) - (EVENT_PRIORITY[left.type] || 0) || String(left.event_id).localeCompare(String(right.event_id)));
}

function sideInputs(side, contract = {}, quality = {}) {
  const starters = (quality?.[side]?.starters || []).map((player) => ({
    player_id: text(player.player_id),
    required_role: player.required_role || null,
    actual_role: player.actual_role || player.required_role || 'unknown',
    effective_quality: number(player.effective_quality, 50)
  })).filter((player) => player.player_id);
  const benchQuality = new Map((quality?.[side]?.bench?.players || []).map((player) => [text(player.player_id), player]));
  const bench = (contract?.teams?.[side]?.bench || []).map((playerId) => {
    const qualityRow = benchQuality.get(text(playerId)) || {};
    return {
      player_id: text(playerId),
      actual_role: qualityRow.actual_role || 'unknown',
      effective_quality: number(qualityRow.effective_quality, 50)
    };
  }).filter((player) => player.player_id);
  return { starters, bench };
}

function replacementSuitability(actualRole, requiredRole) {
  const actual = actualRole || 'unknown';
  const required = requiredRole || 'unknown';
  if (required === 'gk') return actual === 'gk' ? 5 : -1;
  if (actual === 'gk') return -1;
  if (actual === required) return 5;
  if (ROLE_ADJACENT[required]?.has(actual) || ROLE_ADJACENT[actual]?.has(required)) return 4;
  if (ROLE_UNIT[required] && ROLE_UNIT[required] === ROLE_UNIT[actual]) return 3;
  if (actual === 'unknown') return 2;
  return 1;
}

function takeCompatibleReplacement(unusedBench, requiredRole) {
  const ranked = unusedBench
    .map((player, index) => ({ player, index, suitability: replacementSuitability(player.actual_role, requiredRole) }))
    .filter((row) => row.suitability >= 0)
    .sort((left, right) => right.suitability - left.suitability || right.player.effective_quality - left.player.effective_quality || left.player.player_id.localeCompare(right.player.player_id));
  const selected = ranked[0];
  if (!selected) return null;
  unusedBench.splice(selected.index, 1);
  return selected.player;
}

function substitutionEvent(side, index, minute, playerOutId, playerInId, reason, sourceEventId = null) {
  return {
    event_id: `${side}-substitution-${index}`,
    minute: clamp(Math.trunc(minute), 1, 120),
    side,
    type: 'substitution',
    subtype: reason === 'injury' ? 'injury_substitution' : 'tactical_substitution',
    player_out_id: playerOutId,
    player_in_id: playerInId,
    reason,
    source_event_id: sourceEventId,
    provisional: true,
    commentary_hook: reason === 'injury' ? 'injury_substitution' : 'substitution'
  };
}

function disciplinaryTimeline(side, baseEvents) {
  return orderEvents(baseEvents
    .filter((event) => event.side === side && ['yellow_card', 'red_card'].includes(event.type) && event.player_id)
    .map((event) => ({ ...event })));
}

function buildSideSubstitutions(side, baseEvents, contract, quality) {
  const { starters, bench } = sideInputs(side, contract, quality);
  const active = new Set(starters.map((player) => player.player_id));
  const unusedBench = [...bench];
  const substitutions = [];
  const discipline = disciplinaryTimeline(side, baseEvents);
  const yellows = new Map();
  let disciplineIndex = 0;
  let index = 0;

  const applyDisciplineThrough = (minute) => {
    while (disciplineIndex < discipline.length && discipline[disciplineIndex].minute <= minute) {
      const event = discipline[disciplineIndex];
      const playerId = text(event.player_id);
      if (event.type === 'red_card') active.delete(playerId);
      if (event.type === 'yellow_card') {
        const count = (yellows.get(playerId) || 0) + 1;
        yellows.set(playerId, count);
        if (count >= 2) active.delete(playerId);
      }
      disciplineIndex += 1;
    }
  };

  const triggers = [
    ...baseEvents
      .filter((event) => event.side === side && event.type === 'injury' && event.player_id)
      .map((event) => ({ kind: 'injury', minute: clamp(Math.trunc(event.minute) + 1, 1, 120), source: event })),
    ...[60, 70, 80].map((minute) => ({ kind: 'tactical', minute, source: null }))
  ].sort((left, right) => left.minute - right.minute || (left.kind === 'injury' ? -1 : 1));

  for (const trigger of triggers) {
    if (substitutions.length >= MAXIMUM_SUBSTITUTIONS || !unusedBench.length) break;
    applyDisciplineThrough(trigger.minute);

    if (trigger.kind === 'injury') {
      const playerOutId = text(trigger.source.player_id);
      if (!active.has(playerOutId)) continue;
      const playerOut = starters.find((player) => player.player_id === playerOutId);
      const replacement = takeCompatibleReplacement(unusedBench, playerOut?.required_role);
      if (!replacement) continue;
      active.delete(playerOutId);
      active.add(replacement.player_id);
      index += 1;
      substitutions.push(substitutionEvent(side, index, trigger.minute, playerOutId, replacement.player_id, 'injury', trigger.source.event_id));
      continue;
    }

    const candidates = starters
      .filter((player) => active.has(player.player_id) && player.required_role !== 'gk')
      .sort((left, right) => left.effective_quality - right.effective_quality || left.player_id.localeCompare(right.player.player_id));
    let playerOut = null;
    let replacement = null;
    for (const candidate of candidates) {
      replacement = takeCompatibleReplacement(unusedBench, candidate.required_role);
      if (replacement) {
        playerOut = candidate;
        break;
      }
    }
    if (!playerOut || !replacement) continue;
    active.delete(playerOut.player_id);
    active.add(replacement.player_id);
    index += 1;
    substitutions.push(substitutionEvent(side, index, trigger.minute, playerOut.player_id, replacement.player_id, 'tactical'));
  }

  return { substitutions, initial: starters.map((player) => player.player_id), bench: bench.map((player) => player.player_id) };
}

function removeActivePlayer(active, removed, minutes, playerId, minute) {
  if (!active.has(playerId)) return;
  active.delete(playerId);
  removed.add(playerId);
  const row = minutes.get(playerId) || { entered: 0, left: 90 };
  row.left = Math.min(row.left, minute);
  minutes.set(playerId, row);
}

function reconcileGeneratedSubstitutions(events, lineupInputs) {
  const state = Object.fromEntries(['home', 'away'].map((side) => [side, {
    active: new Set(lineupInputs[side].initial),
    availableBench: new Set(lineupInputs[side].bench),
    usedPlayers: new Set(lineupInputs[side].initial),
    yellows: new Map()
  }]));
  const reconciled = [];

  for (const event of orderEvents(events.map((row) => ({ ...row })))) {
    const sideState = state[event.side];
    if (!sideState) {
      reconciled.push(event);
      continue;
    }

    if (event.type === 'substitution') {
      const outId = text(event.player_out_id);
      const inId = text(event.player_in_id);
      const feasible = sideState.active.has(outId)
        && sideState.availableBench.has(inId)
        && !sideState.usedPlayers.has(inId);
      if (!feasible && event.provisional) continue;
      reconciled.push(event);
      if (feasible) {
        sideState.active.delete(outId);
        sideState.active.add(inId);
        sideState.availableBench.delete(inId);
        sideState.usedPlayers.add(inId);
      }
      continue;
    }

    reconciled.push(event);
    if (event.type === 'yellow_card' && event.player_id) {
      const playerId = text(event.player_id);
      const count = (sideState.yellows.get(playerId) || 0) + 1;
      sideState.yellows.set(playerId, count);
      if (count >= 2) sideState.active.delete(playerId);
    }
    if (event.type === 'red_card' && event.player_id) sideState.active.delete(text(event.player_id));
  }

  return reconciled;
}

function applyLineupTimeline(side, events, initial, bench) {
  const active = new Set(initial);
  const availableBench = new Set(bench);
  const usedPlayers = new Set(initial);
  const removed = new Set();
  const minutes = new Map(initial.map((playerId) => [playerId, { entered: 0, left: 90 }]));
  const substitutions = [];
  const yellows = new Map();

  for (const event of events.filter((row) => row.side === side)) {
    if (event.type === 'substitution') {
      const outId = text(event.player_out_id);
      const inId = text(event.player_in_id);
      if (!active.has(outId)) throw new Error(`Module E substitution removes inactive player: ${event.event_id}`);
      if (!availableBench.has(inId) || usedPlayers.has(inId)) throw new Error(`Module E substitution introduces unavailable player: ${event.event_id}`);
      removeActivePlayer(active, removed, minutes, outId, event.minute);
      active.add(inId);
      availableBench.delete(inId);
      usedPlayers.add(inId);
      minutes.set(inId, { entered: event.minute, left: 90 });
      substitutions.push({ event_id: event.event_id, minute: event.minute, player_out_id: outId, player_in_id: inId, reason: event.reason || 'tactical' });
      continue;
    }
    if (event.type === 'yellow_card' && event.player_id) {
      const playerId = text(event.player_id);
      const count = (yellows.get(playerId) || 0) + 1;
      yellows.set(playerId, count);
      if (count >= 2) removeActivePlayer(active, removed, minutes, playerId, event.minute);
    }
    if (event.type === 'red_card' && event.player_id) removeActivePlayer(active, removed, minutes, text(event.player_id), event.minute);
  }

  return deepFreeze({
    starting_xi: [...initial], final_on_pitch: [...active], remaining_bench: [...availableBench], removed_players: [...removed], substitutions,
    players_used: [...usedPlayers], minutes_played: [...minutes.entries()].map(([player_id, row]) => ({ player_id, minutes: clamp(row.left - row.entered, 0, 90) }))
  });
}

function playerRoles(quality = {}) {
  const roles = { home: new Map(), away: new Map() };
  for (const side of ['home', 'away']) {
    const rows = [...(quality?.[side]?.starters || []), ...(quality?.[side]?.bench?.players || [])];
    for (const player of rows) {
      const playerId = text(player.player_id);
      if (playerId) roles[side].set(playerId, player.actual_role || player.required_role || 'unknown');
    }
  }
  return roles;
}

function playerQuality(quality = {}) {
  const rows = { home: new Map(), away: new Map() };
  for (const side of ['home', 'away']) {
    for (const player of [...(quality?.[side]?.starters || []), ...(quality?.[side]?.bench?.players || [])]) {
      const playerId = text(player.player_id);
      if (playerId) rows[side].set(playerId, number(player.effective_quality, 50));
    }
  }
  return rows;
}

function actorEligible(event, role) {
  if (!role || role === 'unknown') return true;
  if (event.type === 'injury' || event.type === 'substitution') return true;
  if (['shot', 'big_chance', 'goal'].includes(event.type)) return role !== 'gk';
  if (event.type === 'penalty' && event.subtype === 'penalty_attempt') return role !== 'gk';
  if (event.type === 'foul' && event.subtype === 'penalty_foul') return role !== 'gk';
  if (['foul', 'yellow_card', 'red_card'].includes(event.type)) return role !== 'gk';
  return true;
}

function reassignInvalidActors(events, lineupBySide, quality) {
  const active = { home: new Set(lineupBySide.home.starting_xi), away: new Set(lineupBySide.away.starting_xi) };
  const roles = playerRoles(quality);
  const yellows = { home: new Map(), away: new Map() };
  const replacement = (side, event) => [...active[side]]
    .filter((playerId) => actorEligible(event, roles[side].get(playerId)))
    .sort((left, right) => left.localeCompare(right))[0] || null;

  return orderEvents(events.map((event) => ({ ...event }))).map((event) => {
    const side = event.side;
    if (!active[side]) return event;
    if (event.type === 'substitution') {
      active[side].delete(text(event.player_out_id));
      active[side].add(text(event.player_in_id));
      return event;
    }

    let updated = event;
    const actorId = text(event.player_id);
    const actorIsActive = !actorId || active[side].has(actorId);
    const actorHasEligibleRole = !actorId || actorEligible(event, roles[side].get(actorId));
    if (actorId && event.type !== 'injury' && (!actorIsActive || !actorHasEligibleRole)) {
      const replacementId = replacement(side, event);
      updated = {
        ...event,
        player_id: replacementId,
        reassigned_from_player_id: actorId,
        actor_reassignment_reason: !actorIsActive ? 'inactive_actor' : 'ineligible_role'
      };
    }

    if (updated.type === 'yellow_card' && updated.player_id) {
      const playerId = text(updated.player_id);
      const count = (yellows[side].get(playerId) || 0) + 1;
      yellows[side].set(playerId, count);
      if (count >= 2) active[side].delete(playerId);
    }
    if (updated.type === 'red_card' && updated.player_id) active[side].delete(text(updated.player_id));
    return updated;
  });
}

function weightedAssistCandidate(side, scorerId, active, roles, qualities, eventId, fixtureNamespace) {
  const candidates = [...active[side]]
    .filter((playerId) => playerId !== scorerId && roles[side].get(playerId) !== 'gk')
    .map((playerId) => {
      const role = roles[side].get(playerId) || 'unknown';
      const roleWeight = ASSIST_ROLE_WEIGHT[role] || ASSIST_ROLE_WEIGHT.unknown;
      return { playerId, weight: Math.max(1, qualities[side].get(playerId) || 50) * roleWeight };
    })
    .sort((left, right) => left.playerId.localeCompare(right.playerId));
  if (!candidates.length) return null;
  const total = candidates.reduce((sum, row) => sum + row.weight, 0);
  const target = stableUnit(`${fixtureNamespace}:${eventId}:assist-player`) * total;
  let cursor = 0;
  for (const candidate of candidates) {
    cursor += candidate.weight;
    if (target <= cursor) return candidate.playerId;
  }
  return candidates[candidates.length - 1].playerId;
}

function attributeGoalAssists(events, lineupBySide, quality, fixtureNamespace) {
  const active = { home: new Set(lineupBySide.home.starting_xi), away: new Set(lineupBySide.away.starting_xi) };
  const roles = playerRoles(quality);
  const qualities = playerQuality(quality);
  const yellows = { home: new Map(), away: new Map() };

  return orderEvents(events.map((event) => ({ ...event }))).map((event) => {
    const side = event.side;
    if (!active[side]) return event;
    if (event.type === 'substitution') {
      active[side].delete(text(event.player_out_id));
      active[side].add(text(event.player_in_id));
      return event;
    }

    let updated = event;
    const assistableGoal = event.type === 'goal'
      && event.subtype !== 'penalty_goal'
      && event.own_goal !== true
      && event.player_id
      && stableUnit(`${fixtureNamespace}:${event.event_id}:assist-awarded`) < ASSISTED_OPEN_PLAY_SHARE;
    if (assistableGoal) {
      const assisterId = weightedAssistCandidate(side, text(event.player_id), active, roles, qualities, event.event_id, fixtureNamespace);
      if (assisterId) updated = { ...event, assist_player_id: assisterId, assist_source: 'causal_active_teammate' };
    }

    if (updated.type === 'yellow_card' && updated.player_id) {
      const playerId = text(updated.player_id);
      const count = (yellows[side].get(playerId) || 0) + 1;
      yellows[side].set(playerId, count);
      if (count >= 2) active[side].delete(playerId);
    }
    if (updated.type === 'red_card' && updated.player_id) active[side].delete(text(updated.player_id));
    return updated;
  });
}

export function resolveLineupEvents(eventGeneration, contract = {}, quality = {}) {
  const baseEvents = (eventGeneration?.provisional_event_stream || []).map((event) => ({ ...event }));
  if (!contract?.teams || !quality?.home || !quality?.away) return deepFreeze({ events: orderEvents(baseEvents), lineups: null });
  const home = buildSideSubstitutions('home', baseEvents, contract, quality);
  const away = buildSideSubstitutions('away', baseEvents, contract, quality);
  const combined = reconcileGeneratedSubstitutions(
    [...baseEvents, ...home.substitutions, ...away.substitutions],
    { home, away }
  );
  const preliminary = {
    home: applyLineupTimeline('home', combined, home.initial, home.bench),
    away: applyLineupTimeline('away', combined, away.initial, away.bench)
  };
  const reassigned = reassignInvalidActors(combined, preliminary, quality);
  const fixtureNamespace = text(eventGeneration?.seed_commitment) || 'unseeded-fixture';
  const assisted = attributeGoalAssists(reassigned, preliminary, quality, fixtureNamespace);
  const events = reconcileGeneratedSubstitutions(assisted, { home, away });
  const lineups = deepFreeze({
    home: applyLineupTimeline('home', events, home.initial, home.bench),
    away: applyLineupTimeline('away', events, away.initial, away.bench)
  });
  return deepFreeze({ events, lineups });
}
