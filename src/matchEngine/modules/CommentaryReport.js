const text = (value) => String(value ?? '').trim();
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

export const COMMENTARY_REPORT_VERSION = 'tbg-commentary-report-v0.4';
export const COMMENTARY_REPORT_STATE_KEY = 'module_f_commentary_report';

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function clubName(team, fallback) { return text(team?.club_name || team?.name || team?.display_name || team?.club_id) || fallback; }

function playerLookup(quality = {}) {
  const lookup = new Map();
  for (const side of ['home', 'away']) {
    for (const player of quality?.[side]?.starters || []) lookup.set(String(player.player_id), player.display_name || player.player_id);
    for (const player of quality?.[side]?.bench?.players || []) lookup.set(String(player.player_id), player.display_name || player.player_id);
  }
  return lookup;
}

function eventSentence(event, names, clubs) {
  const club = clubs[event.side];
  const player = event.player_id ? names.get(String(event.player_id)) || 'A player' : club;
  switch (event.type) {
    case 'goal': return event.subtype === 'penalty_goal' ? `${player} scores from the penalty spot for ${club}.` : `${player} scores for ${club}.`;
    case 'big_chance': return `${player} has a major chance for ${club}, but it does not go in.`;
    case 'shot': return event.on_target ? `${player} tests the goalkeeper for ${club}.` : `${player} sends an effort off target for ${club}.`;
    case 'foul': return event.subtype === 'penalty_foul' ? `${player} concedes a penalty for ${club}.` : `${player} commits a foul for ${club}.`;
    case 'penalty':
      if (event.subtype === 'penalty_attempt') {
        if (event.outcome === 'goal') return `${player} converts the penalty for ${club}.`;
        if (event.outcome === 'saved') return `${player}'s penalty is saved.`;
        if (event.outcome === 'retake') return `${player}'s penalty must be retaken.`;
        return `${player} misses the penalty for ${club}.`;
      }
      return `${club} are awarded a penalty.`;
    case 'substitution': {
      const playerOut = names.get(String(event.player_out_id)) || event.player_out_id || 'a player';
      const playerIn = names.get(String(event.player_in_id)) || event.player_in_id || 'a replacement';
      return event.reason === 'injury'
        ? `${playerIn} replaces the injured ${playerOut} for ${club}.`
        : `${club} replace ${playerOut} with ${playerIn}.`;
    }
    case 'red_card': return `${player} is sent off for ${club}.`;
    case 'yellow_card': return `${player} is booked for ${club}.`;
    case 'injury': return `${player} suffers an injury concern for ${club}.`;
    case 'set_piece': return event.subtype === 'corner' ? `${club} win a corner.` : `${club} win a dangerous free kick.`;
    default: return `${club} create an important moment.`;
  }
}

function headline(score, clubs) {
  if (score.home > score.away) return `${clubs.home} beat ${clubs.away} ${score.home}-${score.away}`;
  if (score.away > score.home) return `${clubs.away} beat ${clubs.home} ${score.away}-${score.home}`;
  return `${clubs.home} and ${clubs.away} draw ${score.home}-${score.away}`;
}

function summary(resolution, clubs) {
  const home = resolution.statistics.home; const away = resolution.statistics.away;
  const dominant = home.shots > away.shots ? clubs.home : away.shots > home.shots ? clubs.away : null;
  const xgLeader = home.expected_goals > away.expected_goals ? clubs.home : away.expected_goals > home.expected_goals ? clubs.away : null;
  const parts = [`${clubs.home} ${resolution.score.home}-${resolution.score.away} ${clubs.away}.`];
  parts.push(dominant ? `${dominant} produced the greater shot volume.` : 'The shot count was level.');
  if (xgLeader) parts.push(`${xgLeader} also led the expected-goals measure.`);
  if (home.penalties_awarded + away.penalties_awarded > 0) parts.push('A penalty incident shaped the contest.');
  if (home.penalty_retakes + away.penalty_retakes > 0) parts.push('The referee also ordered a penalty retake.');
  if (home.red_cards + away.red_cards > 0) parts.push('A sending-off changed the shape of the contest.');
  if (home.injuries + away.injuries > 0) parts.push('The match also contained an injury concern.');
  if (home.injury_substitutions + away.injury_substitutions > 0) parts.push('At least one injury forced a change of personnel.');
  return parts.join(' ');
}

function talkingPoints(resolution, tactical = {}, quality = {}) {
  const points = []; const score = resolution.score; const stats = resolution.statistics;
  const tacticalEdge = number(tactical?.matchup?.net?.home_advantage, 0);
  if (Math.abs(tacticalEdge) >= 0.03) points.push(tacticalEdge > 0 ? 'The home tactical plan held a measurable matchup edge.' : 'The away tactical plan held a measurable matchup edge.');
  const qualityGap = number(quality?.home?.team_strength, 0) - number(quality?.away?.team_strength, 0);
  if (Math.abs(qualityGap) >= 1.5) points.push(qualityGap > 0 ? 'The home side entered with the stronger selected XI.' : 'The away side entered with the stronger selected XI.');
  if (stats.home.shots_on_target !== stats.away.shots_on_target) points.push(stats.home.shots_on_target > stats.away.shots_on_target ? 'The home side put more efforts on target.' : 'The away side put more efforts on target.');
  if (score.home === score.away) points.push('Neither side converted enough of its opportunities to separate the teams.');
  else { const winner = score.home > score.away ? 'home' : 'away'; const loser = winner === 'home' ? 'away' : 'home'; if (stats[winner].expected_goals < stats[loser].expected_goals) points.push('The winner prevailed despite trailing on expected goals.'); }
  return points.slice(0, 4);
}

function keyEvents(events) {
  const priority = { goal: 8, red_card: 7, penalty: 6, injury: 5, substitution: 5, foul: 3, big_chance: 3, yellow_card: 2, set_piece: 1, shot: 0 };
  return [...events].sort((left, right) => (priority[right.type] || 0) - (priority[left.type] || 0) || left.minute - right.minute).slice(0, 14).sort((left, right) => left.minute - right.minute);
}

export function resolveCommentaryReport(contract, resolution, tactical = {}, quality = {}, fatigue = {}) {
  if (!resolution?.resolution_complete) throw new Error('Module F requires completed Module E match resolution');
  const clubs = { home: clubName(contract?.teams?.home, 'Home'), away: clubName(contract?.teams?.away, 'Away') };
  const names = playerLookup(quality);
  const commentary = keyEvents(resolution.official_event_stream || []).map((event) => deepFreeze({ minute: event.minute, side: event.side, type: event.type, event_id: event.event_id, text: eventSentence(event, names, clubs) }));
  return deepFreeze({
    version: COMMENTARY_REPORT_VERSION,
    fixture_id: contract?.fixture?.fixture_id || contract?.fixture?.id || null,
    headline: headline(resolution.score, clubs), summary: summary(resolution, clubs), score: resolution.score, clubs, commentary,
    talking_points: talkingPoints(resolution, tactical, quality), statistics: resolution.statistics, lineup_state: resolution.lineup_state,
    tactical_context: {
      home: tactical?.home ? { formation: tactical.home.formation, style: tactical.home.style, route_to_goal: tactical.home.route_to_goal } : null,
      away: tactical?.away ? { formation: tactical.away.formation, style: tactical.away.style, route_to_goal: tactical.away.route_to_goal } : null
    },
    condition_context: { home_average_fitness: fatigue?.home?.team?.average_fitness ?? null, away_average_fitness: fatigue?.away?.team?.average_fitness ?? null },
    report_complete: true, public_contract_transition_pending: true, applied_to_public_result: false
  });
}

export function executeCommentaryReport(context) {
  const result = resolveCommentaryReport(context.contract, context.get('module_e_match_resolution'), context.get('module_a_tactical_resolution'), context.get('module_b_player_quality'), context.get('module_c_fatigue_context'));
  context.set(COMMENTARY_REPORT_STATE_KEY, result);
  return context;
}
