const matchCentreFetch = window.fetch.bind(window);
let matchCentreAuth = '';
let replayTimer = null;
let replayState = null;

const mcEscape = (value) => String(value ?? '').replace(/[&<>\"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;' }[character]));
const mcNumber = (value) => value === null || value === undefined || value === '' ? null : Number.isFinite(Number(value)) ? Number(value) : null;
const normalType = (type) => String(type || 'event').trim().toLowerCase().replaceAll(' ', '_').replaceAll('-', '_');
const eventTypeMeta = (type) => {
  const key = normalType(type);
  const exact = {
    goal: ['⚽', 'goal', 'Goal'], assist: ['↪', 'assist', 'Assist'], yellow_card: ['🟨', 'yellow-card', 'Yellow card'],
    red_card: ['🟥', 'red-card', 'Red card'], second_yellow: ['🟨🟥', 'red-card', 'Second yellow · red card'],
    penalty_awarded: ['●', 'penalty-awarded', 'Penalty awarded'], penalty_scored: ['⚽ P', 'penalty-scored', 'Penalty scored'],
    penalty_missed: ['✕ P', 'penalty-missed', 'Penalty missed'], penalty_saved: ['🧤 P', 'penalty-saved', 'Penalty saved'],
    free_kick: ['●', 'free-kick', 'Free kick'], foul: ['·', 'foul', 'Foul'], save: ['🧤', 'save', 'Save'],
    chance_attempt: ['•', 'chance', 'Chance'], chance_saved: ['🧤', 'save', 'Saved'], chance_missed: ['↗', 'chance', 'Wide'],
    chance_woodwork: ['▥', 'chance', 'Off the woodwork'], chance_offside: ['⚑', 'chance', 'Offside'], chance_outcome: ['•', 'chance', 'Outcome'],
    tackle: ['◆', 'defensive-action', 'Tackle'], interception: ['◆', 'defensive-action', 'Interception'], block: ['◆', 'defensive-action', 'Block'],
    substitution: ['⇄', 'substitution', 'Substitution'], injury: ['✚', 'injury', 'Injury'], full_time: ['■', 'full-time', 'Full time']
  };
  const [icon, className, label] = exact[key] || (key.includes('goal') ? exact.goal : key.includes('card') ? exact.yellow_card : ['•', 'generic', key.replaceAll('_', ' ')]);
  return { icon, className: `event-${className}`, label };
};
const FALLBACK_MAJOR_EVENTS = Object.freeze({
  goal: { importance: 'major', major: true, kind: 'goal', label: 'GOAL', hold_ms: 2800, priority: 100 },
  penalty_scored: { importance: 'major', major: true, kind: 'goal', label: 'PENALTY GOAL', hold_ms: 2800, priority: 100 },
  penalty_missed: { importance: 'major', major: true, kind: 'penalty', label: 'PENALTY MISSED', hold_ms: 2400, priority: 90 },
  penalty_saved: { importance: 'major', major: true, kind: 'penalty', label: 'PENALTY SAVED', hold_ms: 2400, priority: 90 },
  red_card: { importance: 'major', major: true, kind: 'dismissal', label: 'RED CARD', hold_ms: 2400, priority: 80 },
  second_yellow: { importance: 'major', major: true, kind: 'dismissal', label: 'SECOND YELLOW · RED CARD', hold_ms: 2600, priority: 82 },
  penalty_awarded: { importance: 'major', major: true, kind: 'penalty', label: 'PENALTY', hold_ms: 2200, priority: 70 }
});
const eventPresentation = (event = {}) => event.replay_presentation || FALLBACK_MAJOR_EVENTS[normalType(event.event_type)] || { importance: 'standard', major: false, kind: 'commentary', label: null, hold_ms: 0, priority: 0 };
const isMajorReplayEvent = (event) => eventPresentation(event).major === true;
const orderReplayMoments = (moments = []) => {
  const goalSequences = new Set(moments
    .filter((moment) => eventPresentation(moment.event).kind === 'goal')
    .map((moment) => eventPresentation(moment.event).sequence_id)
    .filter(Boolean));
  return moments.map((moment, index) => ({ moment, index })).sort((left, right) => {
    const leftPresentation = eventPresentation(left.moment.event);
    const rightPresentation = eventPresentation(right.moment.event);
    const leftGoalSequence = Boolean(leftPresentation.sequence_id && goalSequences.has(leftPresentation.sequence_id));
    const rightGoalSequence = Boolean(rightPresentation.sequence_id && goalSequences.has(rightPresentation.sequence_id));
    if (leftGoalSequence !== rightGoalSequence) return leftGoalSequence ? -1 : 1;
    if (leftGoalSequence && rightGoalSequence && leftPresentation.sequence_id === rightPresentation.sequence_id) {
      const sequence = Number(leftPresentation.sequence_order ?? 50) - Number(rightPresentation.sequence_order ?? 50);
      if (sequence) return sequence;
    }
    const priority = Number(rightPresentation.priority || 0) - Number(leftPresentation.priority || 0);
    return priority || left.index - right.index;
  }).map(({ moment }) => moment);
};
const eventText = (event) => {
  if (normalType(event.event_type) === 'substitution' && (event.player_out_name || event.player_in_name)) {
    return `${event.player_out_name || 'Unknown player'} off · ${event.player_in_name || 'Unknown player'} on`;
  }
  if (event.commentary || event.payload?.commentary) return event.commentary || event.payload.commentary;
  const player = event.player_name || 'Unknown player';
  const meta = eventTypeMeta(event.display_event_type || event.event_type);
  if (normalType(event.event_type) === 'goal' || normalType(event.event_type) === 'penalty_scored') return `${meta.label} — ${player}${event.assist_player_name ? ` (assist: ${event.assist_player_name})` : ''}`;
  return `${meta.label.toUpperCase()} — ${player}`;
};
const performanceBadges = (performance) => {
  if (!performance) return '';
  const badges = [];
  if (performance.goals) badges.push(`⚽${performance.goals > 1 ? ` ×${performance.goals}` : ''}`);
  if (performance.assists) badges.push(`↪${performance.assists > 1 ? ` ×${performance.assists}` : ''}`);
  if (performance.yellow_cards) badges.push(`🟨${performance.yellow_cards > 1 ? ` ×${performance.yellow_cards}` : ''}`);
  if (performance.red_cards) badges.push('🟥');
  return badges.length ? `<span class="player-contributions">${badges.map(mcEscape).join(' ')}</span>` : '';
};
const substitutionBadge = (substitution = {}) => {
  const labels = [];
  if (mcNumber(substitution.on_minute) !== null) labels.push(`↑ ${mcNumber(substitution.on_minute)}'`);
  if (mcNumber(substitution.off_minute) !== null) labels.push(`↓ ${mcNumber(substitution.off_minute)}'`);
  return labels.length ? `<span class="player-substitution">${labels.map(mcEscape).join(' ')}</span>` : '';
};
const ratingBadge = (rating) => mcNumber(rating) === null ? '' : `<strong class="match-rating">${mcNumber(rating).toFixed(1)}</strong>`;
const playerList = (players = []) => players.map((player, index) => `<li><span class="shirt-number">${index + 1}</span><span class="lineup-name">${mcEscape(player.name)}</span>${substitutionBadge(player.substitution)}${performanceBadges(player.performance)}${ratingBadge(player.performance?.rating)}</li>`).join('');
const eventMarkup = (event, { replay = false } = {}) => {
  const meta = eventTypeMeta(event.display_event_type || event.event_type);
  const presentation = eventPresentation(event);
  const side = event.side === 'home' || event.side === 'away' ? event.side : 'neutral';
  const tag = replay ? 'p' : 'li';
  const majorClass = presentation.major ? ` major-event major-${mcEscape(presentation.kind)}` : '';
  return `<${tag} class="match-event ${meta.className} side-${side}${majorClass}" data-replay-importance="${mcEscape(presentation.importance)}"><time>${mcEscape(event.minute ?? '—')}'</time><span class="event-icon" aria-label="${mcEscape(meta.label)}">${mcEscape(meta.icon)}</span><span class="event-copy"><strong>${mcEscape(meta.label)}</strong><span>${mcEscape(eventText(event))}</span>${event.assist_player_name ? `<small>↪ ${mcEscape(event.assist_player_name)}</small>` : ''}</span></${tag}>`;
};
const scorerRows = (rows = []) => rows.length ? rows.map((row) => `<li><strong>${mcEscape(row.player_name)}</strong><span>${mcEscape(row.minute)}'${row.penalty ? ' (pen)' : ''}${row.own_goal ? ' (og)' : ''}${row.assist_player_name ? ` · ↪ ${mcEscape(row.assist_player_name)}` : ''}</span></li>`).join('') : '<li><span>No scorers</span></li>';
const cardsSummary = (rows = []) => rows.length ? rows.map((row) => `${eventTypeMeta(row.event_type).icon} ${mcEscape(row.player_name)} ${mcEscape(row.minute)}'`).join('<br>') : 'None';
const topRatingsMarkup = (rows = [], ratingsVersion = null) => rows.length ? rows.map((row, index) => `<li><span>${index + 1}</span><strong>${mcEscape(row.player_name)}</strong><small>${mcEscape(row.side === 'home' ? 'Home' : 'Away')}</small>${ratingBadge(row.rating)}</li>`).join('') : `<li class="ratings-unavailable">${ratingsVersion ? 'No eligible player ratings were produced for this match.' : 'This match was simulated before player performance ratings were introduced.'}</li>`;

window.fetch = async (...args) => {
  const headers = args[1]?.headers || (args[0] instanceof Request ? args[0].headers : null);
  const auth = headers instanceof Headers ? headers.get('authorization') : headers?.authorization;
  if (auth) matchCentreAuth = auth;
  return matchCentreFetch(...args);
};
function ensureMatchCentre() {
  let modal = document.getElementById('matchCentreModal');
  if (modal) return modal;
  modal = document.createElement('div');
  modal.id = 'matchCentreModal'; modal.className = 'match-centre-modal'; modal.hidden = true;
  modal.innerHTML = `<div class="match-centre-shell" role="dialog" aria-modal="true" aria-labelledby="matchCentreTitle"><header><div><span class="teletext-kicker">THE BEAUTIFUL GAME // MATCH CENTRE</span><h2 id="matchCentreTitle">MATCH REPLAY</h2></div><button id="closeMatchCentre" type="button" aria-label="Close match centre">×</button></header><div id="matchCentreContent" class="match-centre-content"></div></div>`;
  document.body.appendChild(modal);
  modal.querySelector('#closeMatchCentre').addEventListener('click', closeMatchCentre);
  modal.addEventListener('click', (event) => { if (event.target === modal) closeMatchCentre(); });
  return modal;
}
function closeMatchCentre() {
  clearInterval(replayTimer); replayTimer = null; replayState = null;
  const modal = document.getElementById('matchCentreModal'); if (modal) modal.hidden = true;
}
function replaySpotlightMarkup() {
  return '<div id="replaySpotlight" class="replay-spotlight" hidden role="status" aria-live="assertive" aria-atomic="true"></div>';
}
function replayMarkup(data) {
  const fixture = data.fixture;
  return `<section class="teletext-scoreboard spoiler-safe"><div><span>HOME</span><strong>${mcEscape(fixture.home_club_name)}</strong></div><div class="teletext-score"><span id="replayStatus">READY</span><b id="headerReplayScore">0-0</b></div><div><span>AWAY</span><strong>${mcEscape(fixture.away_club_name)}</strong></div></section><section class="spoiler-notice"><strong>RESULT HIDDEN</strong><span>Watch the replay or choose SKIP TO FULL TIME to reveal it.</span></section><section class="match-tab active"><div class="replay-console"><div class="replay-clock" id="replayClock">00'</div><div class="replay-score"><span>${mcEscape(fixture.home_club_name)}</span><b id="replayScore">0-0</b><span>${mcEscape(fixture.away_club_name)}</span></div>${replaySpotlightMarkup()}<div id="replayFeed" class="replay-feed"><p>The result is hidden. Press START when you are ready.</p></div><div class="replay-controls"><button id="replayStart" type="button">START</button><button id="replayPause" type="button">PAUSE</button><button id="replaySkip" type="button">SKIP TO FULL TIME</button><label>Speed<select id="replaySpeed"><option value="900">1×</option><option value="450">2×</option><option value="180">5×</option></select></label></div></div></section>`;
}
function renderMatchCentre(data) {
  const modal = ensureMatchCentre(); const content = modal.querySelector('#matchCentreContent'); const fixture = data.fixture;
  if (!data.revealed) { modal.querySelector('#matchCentreTitle').textContent = 'MATCH REPLAY'; content.innerHTML = replayMarkup(data); modal.hidden = false; setupReplay(data, true); return; }
  modal.querySelector('#matchCentreTitle').textContent = 'MATCH REPORT';
  const result = data.result || {}; const stats = result.statistics || {}; const summary = data.summary || {};
  const homeSubmission = (data.submissions || []).find((row) => row.club_id === fixture.home_club_id) || {};
  const awaySubmission = (data.submissions || []).find((row) => row.club_id === fixture.away_club_id) || {};
  const events = data.events || []; const potm = summary.player_of_the_match; const ratingsVersion = result.model?.performance_ratings_version || data.ratings_version || null;
  content.innerHTML = `<section class="teletext-scoreboard"><div><span>HOME</span><strong>${mcEscape(fixture.home_club_name)}</strong></div><div class="teletext-score"><span>FT</span><b>${mcEscape(fixture.home_score)}-${mcEscape(fixture.away_score)}</b></div><div><span>AWAY</span><strong>${mcEscape(fixture.away_club_name)}</strong></div></section><section class="match-summary-grid"><article><h3>${mcEscape(fixture.home_club_name)}</h3><ul>${scorerRows(summary.scorers?.home)}</ul><p><b>Cards</b><br>${cardsSummary(summary.cards?.home)}</p></article><article class="match-stars"><h3>TOP PERFORMERS</h3>${potm ? `<div class="potm"><span>PLAYER OF THE MATCH</span><strong>${mcEscape(potm.player_name)}</strong>${ratingBadge(potm.rating)}</div>` : '<p>Player of the Match unavailable.</p>'}<ol class="top-ratings">${topRatingsMarkup(summary.top_ratings, ratingsVersion)}</ol></article><article><h3>${mcEscape(fixture.away_club_name)}</h3><ul>${scorerRows(summary.scorers?.away)}</ul><p><b>Cards</b><br>${cardsSummary(summary.cards?.away)}</p></article></section><nav class="match-centre-tabs"><button type="button" class="active" data-match-tab="report">REPORT</button><button type="button" data-match-tab="replay">REPLAY</button><button type="button" data-match-tab="lineups">LINE-UPS</button></nav><section id="matchTabReport" class="match-tab active"><div class="teletext-grid"><article class="teletext-panel"><h3>EVENTS</h3><ol class="event-list">${events.length ? events.map((event) => eventMarkup(event)).join('') : '<li>No recorded match events.</li>'}</ol></article><article class="teletext-panel"><h3>MATCH STATISTICS</h3><div class="stat-line"><span>${stats.home?.possession ?? '—'}%</span><b>POSSESSION</b><span>${stats.away?.possession ?? '—'}%</span></div><div class="stat-line"><span>${stats.home?.shots ?? '—'}</span><b>SHOTS</b><span>${stats.away?.shots_on_target ?? '—'}</span></div><div class="stat-line"><span>${stats.home?.shots_on_target ?? '—'}</span><b>ON TARGET</b><span>${stats.away?.shots_on_target ?? '—'}</span></div><div class="match-meta">Matchday ${mcEscape(fixture.matchday ?? '—')}<br>${new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(fixture.played_at))}</div></article></div></section><section id="matchTabReplay" class="match-tab"><div class="replay-console"><div class="replay-clock" id="replayClock">00'</div><div class="replay-score"><span>${mcEscape(fixture.home_club_name)}</span><b id="replayScore">0-0</b><span>${mcEscape(fixture.away_club_name)}</span></div>${replaySpotlightMarkup()}<div id="replayFeed" class="replay-feed"><p>Press START to replay the saved match.</p></div><div class="replay-controls"><button id="replayStart" type="button">START</button><button id="replayPause" type="button">PAUSE</button><button id="replaySkip" type="button">FULL TIME</button><label>Speed<select id="replaySpeed"><option value="900">1×</option><option value="450">2×</option><option value="180">5×</option></select></label></div></div></section><section id="matchTabLineups" class="match-tab"><div class="lineups-grid"><article class="teletext-panel"><h3>${mcEscape(fixture.home_club_name)}</h3><p>${mcEscape(homeSubmission.formation || '—')} · ${mcEscape(homeSubmission.submission_source || '—')}</p><ol class="lineup-list">${playerList(homeSubmission.starting_xi)}</ol><h4>SUBSTITUTES</h4><ol class="lineup-list bench">${playerList(homeSubmission.bench)}</ol></article><article class="teletext-panel"><h3>${mcEscape(fixture.away_club_name)}</h3><p>${mcEscape(awaySubmission.formation || '—')} · ${mcEscape(awaySubmission.submission_source || '—')}</p><ol class="lineup-list">${playerList(awaySubmission.starting_xi)}</ol><h4>SUBSTITUTES</h4><ol class="lineup-list bench">${playerList(awaySubmission.bench)}</ol></article></div></section>`;
  modal.hidden = false;
  content.querySelectorAll('[data-match-tab]').forEach((button) => button.addEventListener('click', () => { content.querySelectorAll('[data-match-tab]').forEach((item) => item.classList.toggle('active', item === button)); content.querySelectorAll('.match-tab').forEach((section) => section.classList.toggle('active', section.id === `matchTab${button.dataset.matchTab[0].toUpperCase()}${button.dataset.matchTab.slice(1)}`)); }));
  setupReplay(data, false);
}
async function revealMatch(data, method) {
  const response = await fetch('/api/reveal-match', { method: 'POST', headers: { authorization: matchCentreAuth, 'content-type': 'application/json' }, body: JSON.stringify({ fixture_id: data.fixture.id, method }) });
  if (!response.ok) { const error = await response.json().catch(() => ({})); throw new Error(error.error || 'Could not reveal match'); }
  document.dispatchEvent(new CustomEvent('tbg:match-revealed', { detail: { fixture_id: data.fixture.id, method } }));
  renderMatchCentre({ ...data, revealed: true, reveal: { reveal_method: method } });
}
function setupReplay(data, revealRequired) {
  const events = [...(data.events || [])].sort((a, b) => Number(a.minute) - Number(b.minute));
  replayState = { minute: 0, home: 0, away: 0, events, nextEvent: 0, data, revealing: false, holdUntil: 0, spotlightEvent: null, spotlightQueue: [], pendingFinish: false };
  const finish = async (method) => { if (!revealRequired || replayState.revealing) return; replayState.revealing = true; try { await revealMatch(data, method); } catch (error) { document.getElementById('replayFeed')?.insertAdjacentHTML('afterbegin', `<p class="replay-error">${mcEscape(error.message)}</p>`); replayState.revealing = false; } };
  const setStatus = (value) => { const status = document.getElementById('replayStatus'); if (status) status.textContent = value; };
  const updateReplayScore = (home = replayState.home, away = replayState.away) => {
    const score = `${home}-${away}`;
    const replayScore = document.getElementById('replayScore'); if (replayScore) replayScore.textContent = score;
    const headerScore = document.getElementById('headerReplayScore'); if (headerScore) headerScore.textContent = score;
  };
  const clearReplaySpotlight = () => {
    if (!replayState) return;
    const spotlight = document.getElementById('replaySpotlight');
    if (spotlight) { spotlight.hidden = true; spotlight.className = 'replay-spotlight'; spotlight.innerHTML = ''; }
    replayState.spotlightEvent = null; replayState.holdUntil = 0; updateReplayScore(); setStatus(replayState.minute >= 90 && !replayState.spotlightQueue.length ? 'FT' : 'LIVE');
  };
  const renderMomentToFeed = (moment) => {
    if (!moment || moment.feedRendered) return;
    const event = moment.event || moment;
    document.getElementById('replayFeed')?.insertAdjacentHTML('afterbegin', eventMarkup(event, { replay: true }));
    moment.feedRendered = true;
  };
  const showReplaySpotlight = (moment) => {
    const event = moment?.event || moment;
    const presentation = eventPresentation(event); if (!presentation.major) return;
    const meta = eventTypeMeta(event.display_event_type || event.event_type); const spotlight = document.getElementById('replaySpotlight'); if (!spotlight) return;
    replayState.spotlightEvent = event;
    replayState.holdUntil = Date.now() + Math.max(0, Number(presentation.hold_ms) || 0);
    const home = Number.isFinite(Number(moment?.home)) ? Number(moment.home) : replayState.home;
    const away = Number.isFinite(Number(moment?.away)) ? Number(moment.away) : replayState.away;
    renderMomentToFeed(moment);
    updateReplayScore(home, away);
    spotlight.hidden = false;
    spotlight.className = `replay-spotlight spotlight-${normalType(presentation.kind || 'major')}`;
    spotlight.innerHTML = `<span class="spotlight-kicker">${mcEscape(presentation.label || meta.label)}</span><div class="spotlight-main"><span class="spotlight-icon">${mcEscape(meta.icon)}</span><strong>${mcEscape(event.minute ?? replayState.minute)}'</strong><span>${mcEscape(eventText(event))}</span></div><b class="spotlight-score">${home}-${away}</b>`;
    setStatus(presentation.label || meta.label.toUpperCase());
  };
  const finalizeReplay = (autoFinish) => {
    clearInterval(replayTimer); replayTimer = null;
    if (!events.some((event) => normalType(event.event_type) === 'full_time')) document.getElementById('replayFeed')?.insertAdjacentHTML('afterbegin', '<p class="full-time">90\' FULL TIME</p>');
    updateReplayScore(); setStatus('FT'); replayState.pendingFinish = false; replayState.spotlightQueue = [];
    if (autoFinish) finish('replay_completed');
  };
  const tick = ({ autoFinish = true, ignoreHold = false, suppressSpotlight = false } = {}) => {
    if (!replayState) return;
    if (!ignoreHold && replayState.holdUntil > Date.now()) return;
    if (replayState.spotlightEvent) clearReplaySpotlight();
    if (!ignoreHold && !suppressSpotlight && replayState.spotlightQueue.length) {
      showReplaySpotlight(replayState.spotlightQueue.shift());
      return;
    }
    if (replayState.pendingFinish || replayState.minute >= 90) { finalizeReplay(autoFinish); return; }
    replayState.minute += 1;
    const minuteMoments = [];
    while (replayState.nextEvent < events.length && Number(events[replayState.nextEvent].minute) <= replayState.minute) {
      const event = events[replayState.nextEvent++]; const type = normalType(event.event_type);
      if ((type === 'goal' || type === 'penalty_scored') && (event.side === 'home' || event.side === 'away')) replayState[event.side] += 1;
      if (!suppressSpotlight && isMajorReplayEvent(event)) {
        minuteMoments.push({ event, home: replayState.home, away: replayState.away, feedRendered: false });
      } else {
        document.getElementById('replayFeed')?.insertAdjacentHTML('afterbegin', eventMarkup(event, { replay: true }));
      }
    }
    const minute = Math.min(replayState.minute, 90); document.getElementById('replayClock').textContent = `${String(minute).padStart(2, '0')}'`;
    if (minuteMoments.length && !ignoreHold && !suppressSpotlight) {
      replayState.spotlightQueue.push(...orderReplayMoments(minuteMoments));
      if (replayState.minute >= 90) replayState.pendingFinish = true;
      showReplaySpotlight(replayState.spotlightQueue.shift());
      return;
    }
    updateReplayScore();
    if (replayState.minute >= 90) finalizeReplay(autoFinish);
  };
  document.getElementById('replayStart').addEventListener('click', () => {
    if (replayTimer) return;
    if (replayState.minute >= 90) {
      replayState.minute = 0; replayState.home = 0; replayState.away = 0; replayState.nextEvent = 0; replayState.pendingFinish = false; replayState.holdUntil = 0; replayState.spotlightEvent = null; replayState.spotlightQueue = [];
      document.getElementById('replayFeed').innerHTML = ''; updateReplayScore(); clearReplaySpotlight();
    }
    setStatus('LIVE'); replayTimer = setInterval(tick, Number(document.getElementById('replaySpeed').value));
  });
  document.getElementById('replayPause').addEventListener('click', () => { clearInterval(replayTimer); replayTimer = null; setStatus(replayState?.spotlightEvent ? eventPresentation(replayState.spotlightEvent).label : 'PAUSED'); });
  document.getElementById('replaySkip').addEventListener('click', async () => {
    clearInterval(replayTimer); replayTimer = null;
    for (const moment of replayState.spotlightQueue) renderMomentToFeed(moment);
    clearReplaySpotlight(); replayState.spotlightQueue = []; replayState.pendingFinish = false;
    while (replayState.minute < 90) tick({ autoFinish: false, ignoreHold: true, suppressSpotlight: true });
    if (revealRequired) await finish('skip_to_full_time');
  });
  document.getElementById('replaySpeed').addEventListener('change', () => { if (replayTimer) { clearInterval(replayTimer); replayTimer = setInterval(tick, Number(document.getElementById('replaySpeed').value)); } });
}
async function openMatchCentre(fixtureId) {
  const modal = ensureMatchCentre(); modal.hidden = false; modal.querySelector('#matchCentreContent').innerHTML = '<div class="match-centre-loading">CONNECTING TO MATCH ARCHIVE…</div>';
  const response = await fetch(`/api/match-centre?fixture_id=${encodeURIComponent(fixtureId)}`, { headers: { authorization: matchCentreAuth } }); const data = await response.json();
  if (!response.ok) { modal.querySelector('#matchCentreContent').innerHTML = `<div class="match-centre-error">${mcEscape(data.error || 'Could not load match report')}</div>`; return; } renderMatchCentre(data);
}
document.addEventListener('click', (event) => { if (event.target.closest('[data-club-id]')) return; const target = event.target.closest('[data-match-centre]'); if (!target) return; event.preventDefault(); openMatchCentre(target.dataset.matchCentre); });
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeMatchCentre(); if (event.target.closest?.('[data-club-id]')) return; const target = event.target.closest?.('[data-match-centre]'); if (target && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); openMatchCentre(target.dataset.matchCentre); } });