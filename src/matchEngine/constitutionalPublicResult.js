const text = (value) => String(value ?? '').trim();
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

export const CONSTITUTIONAL_PUBLIC_RESULT_VERSION = '2d5-v1';
export const CONSTITUTIONAL_PUBLIC_ADAPTER_VERSION = 'tbg-constitutional-public-adapter-v0.2';

function commentaryByEvent(report = {}) {
  return new Map((report.commentary || []).map((row) => [String(row.event_id), row.text]));
}

function fallbackCommentary(event, sideName) {
  const player = event.player_id ? 'A player' : sideName;
  switch (event.type) {
    case 'goal': return `GOAL! ${player} scores for ${sideName}.`;
    case 'big_chance': return `${player} has a major chance for ${sideName}.`;
    case 'shot': return event.on_target ? `${player} tests the goalkeeper.` : `${player} sends an effort wide.`;
    case 'penalty': return `${sideName} are awarded a penalty.`;
    case 'yellow_card': return `${player} is shown a yellow card.`;
    case 'red_card': return `RED CARD — ${player} is sent off.`;
    case 'injury': return `${player} requires treatment for ${sideName}.`;
    case 'set_piece': return event.subtype === 'corner' ? `${sideName} win a corner.` : `${sideName} win a free kick.`;
    default: return `${sideName} create an important moment.`;
  }
}

function eventNamespace(contract = {}) {
  const runKey = text(contract.run_key);
  if (runKey) return runKey;
  const fixtureId = text(contract.fixture?.fixture_id || contract.fixture?.id);
  if (fixtureId) return fixtureId;
  throw new Error('Constitutional public adapter requires run_key or fixture_id for globally unique event IDs');
}

export function publicEventId(contract, internalEventId) {
  const internalId = text(internalEventId);
  if (!internalId) throw new Error('Constitutional public adapter event is missing event_id');
  return `${eventNamespace(contract)}:${internalId}`;
}

function publicEvent(event, report, contract) {
  const internalEventId = text(event.event_id);
  const commentary = commentaryByEvent(report).get(internalEventId);
  const team = contract.teams?.[event.side] || {};
  const sideName = text(team.club_name || team.name || team.display_name || team.club_id) || (event.side === 'home' ? 'Home' : 'Away');
  return {
    event_id: publicEventId(contract, internalEventId),
    internal_event_id: internalEventId,
    type: event.type,
    subtype: event.subtype || null,
    side: event.side,
    minute: event.minute,
    player_id: event.player_id || null,
    assist_player_id: event.assist_player_id || null,
    commentary: commentary || fallbackCommentary(event, sideName),
    xg: event.xg ?? null,
    on_target: event.on_target ?? null,
    outcome: event.outcome || null,
    official: true
  };
}

function possession(eventGeneration = {}) {
  const home = number(eventGeneration.expected?.home?.control_share, 0.5);
  return clamp(Math.round(home * 100), 25, 75);
}

export function runConstitutionalPublicResult(context) {
  const resolution = context.get('module_e_match_resolution');
  const report = context.get('module_f_commentary_report');
  const eventGeneration = context.get('module_d_event_generation');
  if (!resolution?.resolution_complete) throw new Error('Constitutional public adapter requires Module E resolution');
  if (!report?.report_complete) throw new Error('Constitutional public adapter requires Module F report');

  const homePossession = possession(eventGeneration);
  const events = (resolution.official_event_stream || []).map((event) => publicEvent(event, report, context.contract));
  const playedAt = context.fixture?.played_at || context.fixture?.kickoff_at || context.fixture?.scheduled_at || new Date().toISOString();

  return {
    result_version: CONSTITUTIONAL_PUBLIC_RESULT_VERSION,
    run_key: context.contract.run_key,
    fixture_id: context.fixture.fixture_id || context.fixture.id,
    status: 'completed',
    played_at: playedAt,
    score: { ...resolution.score },
    outcome: resolution.result,
    events,
    statistics: {
      home: {
        shots: resolution.statistics.home.shots,
        shots_on_target: resolution.statistics.home.shots_on_target,
        possession: homePossession,
        expected_goals: resolution.statistics.home.expected_goals,
        corners: resolution.statistics.home.corners,
        yellow_cards: resolution.statistics.home.yellow_cards,
        red_cards: resolution.statistics.home.red_cards
      },
      away: {
        shots: resolution.statistics.away.shots,
        shots_on_target: resolution.statistics.away.shots_on_target,
        possession: 100 - homePossession,
        expected_goals: resolution.statistics.away.expected_goals,
        corners: resolution.statistics.away.corners,
        yellow_cards: resolution.statistics.away.yellow_cards,
        red_cards: resolution.statistics.away.red_cards
      }
    },
    report: {
      headline: report.headline,
      summary: report.summary,
      talking_points: report.talking_points
    },
    state_changes: resolution.state_changes,
    model: {
      simulator: 'tbg-constitutional-engine-a-f',
      adapter_version: CONSTITUTIONAL_PUBLIC_ADAPTER_VERSION,
      seed_commitment: resolution.seed_commitment,
      calibrated_profile: 'pr39-baseline-v0.1'
    }
  };
}
