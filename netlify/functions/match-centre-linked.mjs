import matchCentre from './match-centre.mjs';
import { loadPersistentWorld } from '../../src/world/persistentSeasonLoop.js';
import { projectPinkFinalPlayerIdentity } from '../../src/world/pinkFinalPlayerProfile.js';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const PINK_FINAL_BASE_URL = process.env.PINK_FINAL_BASE_URL || undefined;

const text = (value) => String(value ?? '').trim();
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
});

const replayEventType = (value) => text(value).toLowerCase().replace(/[\s-]+/g, '_');
const REPLAY_EVENT_PRESENTATIONS = Object.freeze({
  goal: Object.freeze({ importance: 'major', major: true, featured: true, kind: 'goal', label: 'GOAL', hold_ms: 3200, priority: 100 }),
  penalty_scored: Object.freeze({ importance: 'major', major: true, featured: true, kind: 'goal', label: 'PENALTY GOAL', hold_ms: 3200, priority: 100 }),
  penalty_missed: Object.freeze({ importance: 'major', major: true, featured: true, kind: 'penalty', label: 'PENALTY MISSED', hold_ms: 2400, priority: 90 }),
  penalty_saved: Object.freeze({ importance: 'major', major: true, featured: true, kind: 'penalty', label: 'PENALTY SAVED', hold_ms: 2400, priority: 90 }),
  red_card: Object.freeze({ importance: 'major', major: true, featured: true, kind: 'dismissal', label: 'RED CARD', hold_ms: 2400, priority: 80 }),
  second_yellow: Object.freeze({ importance: 'major', major: true, featured: true, kind: 'dismissal', label: 'SECOND YELLOW', hold_ms: 2400, priority: 80 }),
  penalty_awarded: Object.freeze({ importance: 'major', major: true, featured: true, kind: 'penalty', label: 'PENALTY', hold_ms: 2200, priority: 70 }),
  yellow_card: Object.freeze({ importance: 'featured', major: true, featured: true, kind: 'booking', label: 'YELLOW CARD', hold_ms: 1200, priority: 45 }),
  free_kick: Object.freeze({ importance: 'featured', major: true, featured: true, kind: 'set_piece', label: 'FREE KICK', hold_ms: 1000, priority: 35 }),
  save: Object.freeze({ importance: 'featured', major: true, featured: true, kind: 'save', label: 'SAVE', hold_ms: 1100, priority: 34 }),
  injury: Object.freeze({ importance: 'featured', major: true, featured: true, kind: 'injury', label: 'INJURY', hold_ms: 1400, priority: 33 }),
  substitution: Object.freeze({ importance: 'featured', major: true, featured: true, kind: 'substitution', label: 'SUBSTITUTION', hold_ms: 1000, priority: 25 })
});

export function replayPresentationForEvent(event = {}) {
  const type = replayEventType(event.event_type || event.type || event.kind);
  const outcome = replayEventType(event.outcome || event.payload?.outcome);
  const presentationType = (type === 'shot' || type === 'big_chance') && outcome === 'saved' ? 'save' : type;
  return REPLAY_EVENT_PRESENTATIONS[presentationType] || {
    importance: 'standard',
    major: false,
    featured: false,
    kind: 'commentary',
    label: null,
    hold_ms: 0,
    priority: 0
  };
}

function replayBookingKey(event = {}) {
  const playerId = text(event.player_id || event.tbg_player_id || event.id);
  if (playerId) return `id:${playerId}`;
  const playerName = text(event.player_name || event.name).toLowerCase();
  if (!playerName) return null;
  return `name:${text(event.side).toLowerCase()}:${playerName}`;
}

function isScoredPenaltyEvent(event = {}) {
  return replayEventType(event.event_type || event.type || event.kind) === 'penalty_scored';
}

function dedupeScoredPenaltyEvents(events = []) {
  const byId = new Map(events.map((event) => [text(event.event_id), event]).filter(([id]) => id));
  const suppressedIds = new Set();
  const legacySeen = new Set();
  const suppressedLegacy = new Set();

  events.forEach((event, index) => {
    if (!isScoredPenaltyEvent(event)) return;
    const eventId = text(event.event_id);
    const linkedEventId = text(event.linked_event_id || event.payload?.linked_event_id);
    const sourceEventId = text(event.source_event_id || event.payload?.source_event_id);

    const linkedEvent = linkedEventId ? byId.get(linkedEventId) : null;
    if (eventId && linkedEvent && isScoredPenaltyEvent(linkedEvent)) {
      suppressedIds.add(eventId);
      return;
    }

    const sourceEvent = sourceEventId ? byId.get(sourceEventId) : null;
    if (
      sourceEventId &&
      sourceEvent &&
      isScoredPenaltyEvent(sourceEvent) &&
      text(sourceEvent.linked_event_id || sourceEvent.payload?.linked_event_id) === eventId
    ) {
      suppressedIds.add(sourceEventId);
      return;
    }

    if (!eventId && !linkedEventId && !sourceEventId) {
      const player = text(event.player_id || event.tbg_player_id || event.player_name || event.name).toLowerCase();
      const key = player ? `${text(event.side).toLowerCase()}:${Number(event.minute) || 0}:${player}` : null;
      if (key && legacySeen.has(key)) suppressedLegacy.add(index);
      else if (key) legacySeen.add(key);
    }
  });

  return events.filter((event, index) => !suppressedIds.has(text(event.event_id)) && !suppressedLegacy.has(index));
}

async function canonicalWorld(worldId) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !worldId) return null;
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/canonical_world_saves?world_id=eq.${encodeURIComponent(worldId)}&select=save_envelope&limit=1`,
    {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        accept: 'application/json'
      }
    }
  );
  if (!response.ok) return null;
  const rows = await response.json().catch(() => []);
  return rows[0]?.save_envelope ? loadPersistentWorld(JSON.stringify(rows[0].save_envelope)) : null;
}

function identityFor(world, playerId, fallback = {}) {
  const id = text(playerId);
  if (!id) return { profile_url: null, pink_final_profile_status: 'unpublished' };
  const canonical = world?.squad_cycle?.players?.[id] || {};
  const projected = projectPinkFinalPlayerIdentity(
    { ...fallback, ...canonical, tbg_player_id: canonical.tbg_player_id || id },
    PINK_FINAL_BASE_URL ? { baseUrl: PINK_FINAL_BASE_URL } : {}
  );
  return {
    profile_url: projected.profile_url,
    pink_final_route_key: projected.pink_final_route_key,
    pink_final_profile_status: projected.pink_final_profile_status
  };
}

function decoratePlayer(world, row = {}, idField = 'player_id') {
  const playerId = text(row?.[idField] || row?.player_id || row?.id);
  return { ...row, ...identityFor(world, playerId, row) };
}

function scorerSummaryFromEvents(events = [], side) {
  return events
    .filter((event) => event.side === side && ['goal', 'penalty_scored'].includes(replayEventType(event.event_type)))
    .map((event) => ({
      player_id: event.player_id || null,
      player_name: event.player_name || 'Unknown player',
      profile_url: event.profile_url || null,
      assist_player_id: event.assist_player_id || null,
      assist_player_name: event.assist_player_name || null,
      assist_profile_url: event.assist_profile_url || null,
      minute: Number(event.minute) || 0,
      penalty: replayEventType(event.event_type) === 'penalty_scored' || Boolean(event.penalty || event.payload?.penalty),
      own_goal: Boolean(event.own_goal || event.payload?.own_goal)
    }));
}

export function decorateMatchCentrePayload(payload = {}, world = null) {
  const bookings = new Map();
  const decoratedEvents = (payload.events || []).map((event) => {
    const type = replayEventType(event.event_type || event.type || event.kind);
    let replayPresentation = replayPresentationForEvent(event);
    if (type === 'yellow_card') {
      const bookingKey = replayBookingKey(event);
      if (bookingKey) {
        const bookingCount = (bookings.get(bookingKey) || 0) + 1;
        bookings.set(bookingKey, bookingCount);
        if (bookingCount >= 2) replayPresentation = replayPresentationForEvent({ event_type: 'second_yellow' });
      }
    }
    return {
      ...decoratePlayer(world, event),
      replay_presentation: replayPresentation,
      assist_profile_url: identityFor(world, event.assist_player_id).profile_url,
      player_on_profile_url: identityFor(world, event.player_on_id || event.in_player_id || event.replacement_player_id).profile_url,
      player_off_profile_url: identityFor(world, event.player_off_id || event.out_player_id || event.replaced_player_id).profile_url
    };
  });
  const events = dedupeScoredPenaltyEvents(decoratedEvents);

  const decoratePerformance = (row) => decoratePlayer(world, row);
  const performances = {
    home: (payload.player_performances?.home || []).map(decoratePerformance),
    away: (payload.player_performances?.away || []).map(decoratePerformance)
  };
  const performanceById = new Map([...performances.home, ...performances.away].map((row) => [text(row.player_id), row]));

  const submissions = (payload.submissions || []).map((submission) => {
    const decorateLineupPlayer = (player) => {
      const identity = identityFor(world, player.id || player.player_id, player);
      const performance = player.performance ? { ...player.performance, ...identityFor(world, player.performance.player_id || player.id, player.performance) } : performanceById.get(text(player.id)) || null;
      return { ...player, ...identity, performance };
    };
    return {
      ...submission,
      starting_xi: (submission.starting_xi || []).map(decorateLineupPlayer),
      bench: (submission.bench || []).map(decorateLineupPlayer),
      captain_profile_url: identityFor(world, submission.captain_id).profile_url
    };
  });

  const summary = payload.summary || {};
  const decoratedSummary = {
    ...summary,
    scorers: {
      home: scorerSummaryFromEvents(events, 'home'),
      away: scorerSummaryFromEvents(events, 'away')
    },
    cards: {
      home: (summary.cards?.home || []).map((row) => decoratePlayer(world, row)),
      away: (summary.cards?.away || []).map((row) => decoratePlayer(world, row))
    },
    player_of_the_match: summary.player_of_the_match ? decoratePerformance(summary.player_of_the_match) : null,
    top_ratings: (summary.top_ratings || []).map(decoratePerformance)
  };

  return {
    ...payload,
    events,
    submissions,
    summary: decoratedSummary,
    player_performances: performances
  };
}

export default async (request) => {
  const response = await matchCentre(request);
  if (!response.ok) return response;
  const payload = await response.json().catch(() => null);
  if (!payload) return json({ error: 'Match Centre returned an invalid payload' }, 500);
  const world = await canonicalWorld(payload.fixture?.world_id);
  return json(decorateMatchCentrePayload(payload, world), response.status);
};
