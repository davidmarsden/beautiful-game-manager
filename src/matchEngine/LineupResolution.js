const text = (value) => String(value ?? '').trim();
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

const EVENT_PRIORITY = Object.freeze({ injury: 9, red_card: 8, yellow_card: 7, substitution: 6, goal: 5, penalty: 4, foul: 3, set_piece: 2, big_chance: 1, shot: 0 });

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
    effective_quality: number(player.effective_quality, 50)
  })).filter((player) => player.player_id);
  const benchQuality = new Map((quality?.[side]?.bench?.players || []).map((player) => [text(player.player_id), number(player.effective_quality, 50)]));
  const bench = (contract?.teams?.[side]?.bench || []).map((playerId) => ({
    player_id: text(playerId),
    effective_quality: benchQuality.get(text(playerId)) ?? 50
  })).filter((player) => player.player_id);
  return { starters, bench };
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

function buildSideSubstitutions(side, baseEvents, contract, quality) {
  const { starters, bench } = sideInputs(side, contract, quality);
  const active = new Set(starters.map((player) => player.player_id));
  const unusedBench = [...bench];
  const substitutions = [];
  const unavailable = new Set();
  let index = 0;

  const injuries = orderEvents(baseEvents.filter((event) => event.side === side && event.type === 'injury' && event.player_id).map((event) => ({ ...event })));
  for (const injury of injuries) {
    const playerOutId = text(injury.player_id);
    if (!active.has(playerOutId)) continue;
    active.delete(playerOutId);
    unavailable.add(playerOutId);
    const replacement = unusedBench.shift();
    if (!replacement) continue;
    active.add(replacement.player_id);
    index += 1;
    substitutions.push(substitutionEvent(side, index, injury.minute + 1, playerOutId, replacement.player_id, 'injury', injury.event_id));
  }

  const tacticalMinutes = [60, 70, 80];
  for (const minute of tacticalMinutes) {
    if (!unusedBench.length || substitutions.length >= 5) break;
    const candidates = starters
      .filter((player) => active.has(player.player_id) && player.required_role !== 'gk')
      .sort((left, right) => left.effective_quality - right.effective_quality || left.player_id.localeCompare(right.player_id));
    const playerOut = candidates[0];
    if (!playerOut) break;
    const replacement = unusedBench.shift();
    active.delete(playerOut.player_id);
    active.add(replacement.player_id);
    index += 1;
    substitutions.push(substitutionEvent(side, index, minute, playerOut.player_id, replacement.player_id, 'tactical'));
  }

  return { substitutions, initial: starters.map((player) => player.player_id), bench: bench.map((player) => player.player_id), unavailable: [...unavailable] };
}

function applyLineupTimeline(side, events, initial, bench) {
  const active = new Set(initial);
  const availableBench = new Set(bench);
  const usedPlayers = new Set(initial);
  const removed = new Set();
  const minutes = new Map(initial.map((playerId) => [playerId, { entered: 0, left: 90 }]));
  const substitutions = [];

  for (const event of events.filter((row) => row.side === side)) {
    if (event.type === 'substitution') {
      const outId = text(event.player_out_id);
      const inId = text(event.player_in_id);
      if (!active.has(outId)) throw new Error(`Module E substitution removes inactive player: ${event.event_id}`);
      if (!availableBench.has(inId) || usedPlayers.has(inId)) throw new Error(`Module E substitution introduces unavailable player: ${event.event_id}`);
      active.delete(outId);
      active.add(inId);
      availableBench.delete(inId);
      usedPlayers.add(inId);
      removed.add(outId);
      const outMinutes = minutes.get(outId) || { entered: 0, left: 90 };
      outMinutes.left = Math.min(outMinutes.left, event.minute);
      minutes.set(outId, outMinutes);
      minutes.set(inId, { entered: event.minute, left: 90 });
      substitutions.push({ event_id: event.event_id, minute: event.minute, player_out_id: outId, player_in_id: inId, reason: event.reason || 'tactical' });
      continue;
    }
    if (event.type === 'red_card' && event.player_id && active.has(text(event.player_id))) {
      const playerId = text(event.player_id);
      active.delete(playerId);
      removed.add(playerId);
      const row = minutes.get(playerId) || { entered: 0, left: 90 };
      row.left = Math.min(row.left, event.minute);
      minutes.set(playerId, row);
    }
  }

  return deepFreeze({
    starting_xi: [...initial],
    final_on_pitch: [...active],
    remaining_bench: [...availableBench],
    removed_players: [...removed],
    substitutions,
    players_used: [...usedPlayers],
    minutes_played: [...minutes.entries()].map(([player_id, row]) => ({ player_id, minutes: clamp(row.left - row.entered, 0, 90) }))
  });
}

function reassignInactiveActors(events, lineupBySide) {
  const active = { home: new Set(lineupBySide.home.starting_xi), away: new Set(lineupBySide.away.starting_xi) };
  const replacement = (side) => [...active[side]][0] || null;
  return orderEvents(events.map((event) => ({ ...event }))).map((event) => {
    const side = event.side;
    if (!active[side]) return event;
    if (event.type === 'substitution') {
      active[side].delete(text(event.player_out_id));
      active[side].add(text(event.player_in_id));
      return event;
    }
    if (event.type === 'red_card' && event.player_id) {
      const updated = active[side].has(text(event.player_id)) ? event : { ...event, player_id: replacement(side) };
      if (updated.player_id) active[side].delete(text(updated.player_id));
      return updated;
    }
    if (event.player_id && !active[side].has(text(event.player_id)) && !['injury'].includes(event.type)) {
      return { ...event, player_id: replacement(side), reassigned_from_player_id: text(event.player_id) };
    }
    return event;
  });
}

export function resolveLineupEvents(eventGeneration, contract = {}, quality = {}) {
  const baseEvents = (eventGeneration?.provisional_event_stream || []).map((event) => ({ ...event }));
  if (!contract?.teams || !quality?.home || !quality?.away) {
    return deepFreeze({ events: orderEvents(baseEvents), lineups: null });
  }
  const home = buildSideSubstitutions('home', baseEvents, contract, quality);
  const away = buildSideSubstitutions('away', baseEvents, contract, quality);
  const combined = orderEvents([...baseEvents, ...home.substitutions, ...away.substitutions]);
  const preliminary = {
    home: applyLineupTimeline('home', combined, home.initial, home.bench),
    away: applyLineupTimeline('away', combined, away.initial, away.bench)
  };
  const events = reassignInactiveActors(combined, preliminary);
  const lineups = deepFreeze({
    home: applyLineupTimeline('home', events, home.initial, home.bench),
    away: applyLineupTimeline('away', events, away.initial, away.bench)
  });
  return deepFreeze({ events, lineups });
}
