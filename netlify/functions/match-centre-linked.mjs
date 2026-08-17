import matchCentre from './match-centre.mjs';
import { projectPinkFinalPlayerIdentity } from '../../src/world/pinkFinalPlayerProfile.js';
import { cardSummaryFromEvents, enrichReplayCommentary } from '../../src/matchCentre/replayMomentDirector.js';

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
  second_yellow: Object.freeze({ importance: 'major', major: true, featured: true, kind: 'dismissal', label: 'SECOND YELLOW · RED CARD', hold_ms: 2600, priority: 82 }),
  penalty_awarded: Object.freeze({ importance: 'major', major: true, featured: true, kind: 'penalty', label: 'PENALTY', hold_ms: 2200, priority: 70 }),
  yellow_card: Object.freeze({ importance: 'featured', major: true, featured: true, kind: 'booking', label: 'YELLOW CARD', hold_ms: 1200, priority: 45 }),
  corner: Object.freeze({ importance: 'featured', major: true, featured: true, kind: 'set_piece', label: 'CORNER', hold_ms: 1000, priority: 36 }),
  free_kick: Object.freeze({ importance: 'featured', major: true, featured: true, kind: 'set_piece', label: 'FREE KICK', hold_ms: 1000, priority: 35 }),
  save: Object.freeze({ importance: 'featured', major: true, featured: true, kind: 'save', label: 'SAVE', hold_ms: 1100, priority: 34 }),
  injury: Object.freeze({ importance: 'featured', major: true, featured: true, kind: 'injury', label: 'INJURY', hold_ms: 1400, priority: 33 }),
  substitution: Object.freeze({ importance: 'featured', major: true, featured: true, kind: 'substitution', label: 'SUBSTITUTION', hold_ms: 1000, priority: 25 })
});

function replayPresentationType(event = {}) {
  const type = replayEventType(event.event_type || event.type || event.kind);
  const subtype = replayEventType(event.subtype || event.event_subtype || event.payload?.subtype || event.payload?.event_subtype);
  const outcome = replayEventType(event.outcome || event.payload?.outcome);
  if (type === 'red_card' && subtype === 'second_yellow') return 'second_yellow';
  if (type === 'set_piece' && subtype === 'corner') return 'corner';
  if (type === 'set_piece' && subtype === 'free_kick') return 'free_kick';
  if ((type === 'shot' || type === 'big_chance') && outcome === 'saved') return 'save';
  return type;
}

export function replayPresentationForEvent(event = {}) {
  const presentationType = replayPresentationType(event);
  const base = REPLAY_EVENT_PRESENTATIONS[presentationType] || {
    importance: 'standard', major: false, featured: false, kind: 'commentary', label: null, hold_ms: 0, priority: 0
  };
  const origin = replayEventType(event.chance_origin || event.payload?.chance_origin);
  const sequenceId = text(event.sequence_id || event.payload?.sequence_id) || null;
  const sequenceOrder = Number.isFinite(Number(event.sequence_order ?? event.payload?.sequence_order))
    ? Number(event.sequence_order ?? event.payload?.sequence_order) : null;
  const sequenceRole = presentationType === 'goal' ? 'climax'
    : presentationType === 'corner' || presentationType === 'free_kick' ? 'source'
      : sequenceId ? 'build_up' : null;
  const contextualLabel = presentationType === 'goal' && origin === 'corner' ? 'GOAL · FROM CORNER'
    : presentationType === 'goal' && origin === 'free_kick' ? 'GOAL · FROM FREE KICK' : base.label;
  return { ...base, label: contextualLabel, sequence_id: sequenceId, sequence_order: sequenceOrder, sequence_role: sequenceRole, chance_origin: origin || null };
}

function replayBookingKey(event = {}) {
  const playerId = text(event.player_id || event.tbg_player_id || event.id);
  if (playerId) return `id:${playerId}`;
  const playerName = text(event.player_name || event.name).toLowerCase();
  return playerName ? `name:${text(event.side).toLowerCase()}:${playerName}` : null;
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
    if (eventId && linkedEvent && isScoredPenaltyEvent(linkedEvent)) { suppressedIds.add(eventId); return; }
    const sourceEvent = sourceEventId ? byId.get(sourceEventId) : null;
    if (sourceEventId && sourceEvent && isScoredPenaltyEvent(sourceEvent)
      && text(sourceEvent.linked_event_id || sourceEvent.payload?.linked_event_id) === eventId) {
      suppressedIds.add(sourceEventId); return;
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

async function playerIdentityWorld(worldId) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !worldId) return null;
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_world_player_identity_directory`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      accept: 'application/json',
      'content-type': 'application/json'
    },
    body: JSON.stringify({ p_world_id: worldId })
  });
  if (!response.ok) return null;
  const players = await response.json().catch(() => ({}));
  return { world_id: worldId, squad_cycle: { players: players || {} } };
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
  return events.filter((event) => event.side === side && ['goal', 'penalty_scored'].includes(replayEventType(event.event_type)))
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
  const explicitSecondYellowKeys = new Set((payload.events || [])
    .filter((event) => replayEventType(event.event_type || event.type || event.kind) === 'red_card'
      && replayEventType(event.subtype || event.event_subtype || event.payload?.subtype) === 'second_yellow')
    .map(replayBookingKey).filter(Boolean));
  const decoratedEvents = (payload.events || []).map((event) => {
    const type = replayEventType(event.event_type || event.type || event.kind);
    let replayPresentation = replayPresentationForEvent(event);
    if (type === 'yellow_card') {
      const bookingKey = replayBookingKey(event);
      if (bookingKey) {
        const bookingCount = (bookings.get(bookingKey) || 0) + 1;
        bookings.set(bookingKey, bookingCount);
        if (bookingCount >= 2 && !explicitSecondYellowKeys.has(bookingKey)) replayPresentation = replayPresentationForEvent({ event_type: 'second_yellow' });
      }
    }
    return {
      ...decoratePlayer(world, event), replay_presentation: replayPresentation,
      assist_profile_url: identityFor(world, event.assist_player_id).profile_url,
      player_on_profile_url: identityFor(world, event.player_on_id || event.in_player_id || event.replacement_player_id).profile_url,
      player_off_profile_url: identityFor(world, event.player_off_id || event.out_player_id || event.replaced_player_id).profile_url
    };
  });
  const dedupedEvents = dedupeScoredPenaltyEvents(decoratedEvents);
  const clubs = {
    home: text(payload.fixture?.home_club_name || payload.fixture?.home_name || payload.fixture?.home_club_id),
    away: text(payload.fixture?.away_club_name || payload.fixture?.away_name || payload.fixture?.away_club_id)
  };
  const events = enrichReplayCommentary(dedupedEvents, clubs);
  const decoratePerformance = (row) => decoratePlayer(world, row);
  const performances = {
    home: (payload.player_performances?.home || []).map(decoratePerformance),
    away: (payload.player_performances?.away || []).map(decoratePerformance)
  };
  const performanceById = new Map([...performances.home, ...performances.away].map((row) => [text(row.player_id), row]));
  const submissions = (payload.submissions || []).map((submission) => {
    const decorateLineupPlayer = (player) => {
      const identity = identityFor(world, player.id || player.player_id, player);
      const performance = player.performance
        ? { ...player.performance, ...identityFor(world, player.performance.player_id || player.id, player.performance) }
        : performanceById.get(text(player.id)) || null;
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
    scorers: { home: scorerSummaryFromEvents(events, 'home'), away: scorerSummaryFromEvents(events, 'away') },
    cards: { home: cardSummaryFromEvents(events, 'home'), away: cardSummaryFromEvents(events, 'away') },
    player_of_the_match: summary.player_of_the_match ? decoratePerformance(summary.player_of_the_match) : null,
    top_ratings: (summary.top_ratings || []).map(decoratePerformance)
  };
  return { ...payload, events, submissions, summary: decoratedSummary, player_performances: performances };
}

export default async (request) => {
  const response = await matchCentre(request);
  if (!response.ok) return response;
  const payload = await response.json().catch(() => null);
  if (!payload) return json({ error: 'Match Centre returned an invalid payload' }, 500);
  const world = await playerIdentityWorld(payload.fixture?.world_id);
  return json(decorateMatchCentrePayload(payload, world), response.status);
};
