const matchCentreFetch = window.fetch.bind(window);
let matchCentreAuth = '';
let replayTimer = null;
let replayState = null;
let matchRevealChanged = false;

const mcEscape = (value) => String(value ?? '').replace(/[&<>\"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;' }[character]));
const playerList = (players = []) => players.map((player, index) => `<li><span>${index + 1}</span>${mcEscape(player.name)}</li>`).join('');
const eventText = (event) => {
  const player = event.player_name || 'Unknown player';
  if (event.event_type === 'goal') return `GOAL — ${player}${event.assist_player_name ? ` (assist: ${event.assist_player_name})` : ''}`;
  if (event.event_type === 'yellow_card') return `YELLOW CARD — ${player}`;
  if (event.event_type === 'red_card') return `RED CARD — ${player}`;
  if (event.event_type === 'injury') return `INJURY — ${player}`;
  if (event.event_type === 'substitution') return `SUBSTITUTION — ${player}`;
  return `${String(event.event_type || 'event').replaceAll('_', ' ').toUpperCase()} — ${player}`;
};
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
  if (matchRevealChanged) window.location.reload();
}

function replayMarkup(data) {
  const fixture = data.fixture;
  return `<section class="teletext-scoreboard spoiler-safe"><div><span>HOME</span><strong>${mcEscape(fixture.home_club_name)}</strong></div><div class="teletext-score"><span id="replayStatus">READY</span><b id="headerReplayScore">0-0</b></div><div><span>AWAY</span><strong>${mcEscape(fixture.away_club_name)}</strong></div></section>
  <section class="spoiler-notice"><strong>RESULT HIDDEN</strong><span>Watch the replay or choose SKIP TO FULL TIME to reveal it.</span></section>
  <section class="match-tab active"><div class="replay-console"><div class="replay-clock" id="replayClock">00'</div><div class="replay-score"><span>${mcEscape(fixture.home_club_name)}</span><b id="replayScore">0-0</b><span>${mcEscape(fixture.away_club_name)}</span></div><div id="replayFeed" class="replay-feed"><p>The result is hidden. Press START when you are ready.</p></div><div class="replay-controls"><button id="replayStart" type="button">START</button><button id="replayPause" type="button">PAUSE</button><button id="replaySkip" type="button">SKIP TO FULL TIME</button><label>Speed<select id="replaySpeed"><option value="900">1×</option><option value="450">2×</option><option value="180">5×</option></select></label></div></div></section>`;
}

function renderMatchCentre(data) {
  const modal = ensureMatchCentre();
  const content = modal.querySelector('#matchCentreContent');
  const fixture = data.fixture;
  if (!data.revealed) {
    modal.querySelector('#matchCentreTitle').textContent = 'MATCH REPLAY';
    content.innerHTML = replayMarkup(data);
    modal.hidden = false;
    setupReplay(data, true);
    return;
  }
  modal.querySelector('#matchCentreTitle').textContent = 'MATCH REPORT';
  const result = data.result || {}; const stats = result.statistics || {};
  const homeSubmission = (data.submissions || []).find((row) => row.club_id === fixture.home_club_id) || {};
  const awaySubmission = (data.submissions || []).find((row) => row.club_id === fixture.away_club_id) || {};
  const events = data.events || [];
  content.innerHTML = `<section class="teletext-scoreboard"><div><span>HOME</span><strong>${mcEscape(fixture.home_club_name)}</strong></div><div class="teletext-score"><span>FT</span><b>${mcEscape(fixture.home_score)}-${mcEscape(fixture.away_score)}</b></div><div><span>AWAY</span><strong>${mcEscape(fixture.away_club_name)}</strong></div></section>
  <nav class="match-centre-tabs"><button type="button" class="active" data-match-tab="report">REPORT</button><button type="button" data-match-tab="replay">REPLAY</button><button type="button" data-match-tab="lineups">LINE-UPS</button></nav>
  <section id="matchTabReport" class="match-tab active"><div class="teletext-grid"><article class="teletext-panel"><h3>EVENTS</h3><ol class="event-list">${events.length ? events.map((event) => `<li><time>${mcEscape(event.minute)}'</time><span class="event-side ${mcEscape(event.side)}">${mcEscape(event.side)}</span><strong>${mcEscape(eventText(event))}</strong></li>`).join('') : '<li>No recorded match events.</li>'}</ol></article><article class="teletext-panel"><h3>MATCH STATISTICS</h3><div class="stat-line"><span>${stats.home?.possession ?? '—'}%</span><b>POSSESSION</b><span>${stats.away?.possession ?? '—'}%</span></div><div class="stat-line"><span>${stats.home?.shots ?? '—'}</span><b>SHOTS</b><span>${stats.away?.shots ?? '—'}</span></div><div class="stat-line"><span>${stats.home?.shots_on_target ?? '—'}</span><b>ON TARGET</b><span>${stats.away?.shots_on_target ?? '—'}</span></div><div class="match-meta">Matchday ${mcEscape(fixture.matchday ?? '—')}<br>${new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(fixture.played_at))}</div></article></div></section>
  <section id="matchTabReplay" class="match-tab"><div class="replay-console"><div class="replay-clock" id="replayClock">00'</div><div class="replay-score"><span>${mcEscape(fixture.home_club_name)}</span><b id="replayScore">0-0</b><span>${mcEscape(fixture.away_club_name)}</span></div><div id="replayFeed" class="replay-feed"><p>Press START to replay the saved match.</p></div><div class="replay-controls"><button id="replayStart" type="button">START</button><button id="replayPause" type="button">PAUSE</button><button id="replaySkip" type="button">FULL TIME</button><label>Speed<select id="replaySpeed"><option value="900">1×</option><option value="450">2×</option><option value="180">5×</option></select></label></div></div></section>
  <section id="matchTabLineups" class="match-tab"><div class="lineups-grid"><article class="teletext-panel"><h3>${mcEscape(fixture.home_club_name)}</h3><p>${mcEscape(homeSubmission.formation || '—')} · ${mcEscape(homeSubmission.submission_source || '—')}</p><ol class="lineup-list">${playerList(homeSubmission.starting_xi)}</ol><h4>SUBSTITUTES</h4><ol class="lineup-list bench">${playerList(homeSubmission.bench)}</ol></article><article class="teletext-panel"><h3>${mcEscape(fixture.away_club_name)}</h3><p>${mcEscape(awaySubmission.formation || '—')} · ${mcEscape(awaySubmission.submission_source || '—')}</p><ol class="lineup-list">${playerList(awaySubmission.starting_xi)}</ol><h4>SUBSTITUTES</h4><ol class="lineup-list bench">${playerList(awaySubmission.bench)}</ol></article></div></section>`;
  modal.hidden = false;
  content.querySelectorAll('[data-match-tab]').forEach((button) => button.addEventListener('click', () => { content.querySelectorAll('[data-match-tab]').forEach((item) => item.classList.toggle('active', item === button)); content.querySelectorAll('.match-tab').forEach((section) => section.classList.toggle('active', section.id === `matchTab${button.dataset.matchTab[0].toUpperCase()}${button.dataset.matchTab.slice(1)}`)); }));
  setupReplay(data, false);
}

async function revealMatch(data, method) {
  const response = await fetch('/api/reveal-match', { method: 'POST', headers: { authorization: matchCentreAuth, 'content-type': 'application/json' }, body: JSON.stringify({ fixture_id: data.fixture.id, method }) });
  if (!response.ok) { const error = await response.json().catch(() => ({})); throw new Error(error.error || 'Could not reveal match'); }
  matchRevealChanged = true;
  const refreshed = await fetch(`/api/match-centre?fixture_id=${encodeURIComponent(data.fixture.id)}`, { headers: { authorization: matchCentreAuth } });
  const fullData = await refreshed.json();
  if (!refreshed.ok) throw new Error(fullData.error || 'Could not load revealed match');
  renderMatchCentre(fullData);
}

function setupReplay(data, revealRequired) {
  const events = [...(data.events || [])].sort((a, b) => Number(a.minute) - Number(b.minute));
  replayState = { minute: 0, home: 0, away: 0, events, nextEvent: 0, data, revealing: false };
  const finish = async (method) => {
    if (!revealRequired || replayState.revealing) return;
    replayState.revealing = true;
    try { await revealMatch(data, method); } catch (error) { document.getElementById('replayFeed')?.insertAdjacentHTML('afterbegin', `<p class="replay-error">${mcEscape(error.message)}</p>`); replayState.revealing = false; }
  };
  const tick = () => {
    if (!replayState) return;
    replayState.minute += 1;
    while (replayState.nextEvent < events.length && Number(events[replayState.nextEvent].minute) <= replayState.minute) {
      const event = events[replayState.nextEvent++];
      if (event.event_type === 'goal') replayState[event.side] += 1;
      document.getElementById('replayFeed')?.insertAdjacentHTML('afterbegin', `<p class="replay-event ${mcEscape(event.event_type)}"><time>${mcEscape(event.minute)}'</time> ${mcEscape(eventText(event))}</p>`);
    }
    const minute = Math.min(replayState.minute, 90);
    document.getElementById('replayClock').textContent = `${String(minute).padStart(2, '0')}'`;
    document.getElementById('replayScore').textContent = `${replayState.home}-${replayState.away}`;
    const headerScore = document.getElementById('headerReplayScore'); if (headerScore) headerScore.textContent = `${replayState.home}-${replayState.away}`;
    if (replayState.minute >= 90) { clearInterval(replayTimer); replayTimer = null; document.getElementById('replayFeed')?.insertAdjacentHTML('afterbegin', '<p class="full-time">90\' FULL TIME</p>'); finish('replay_completed'); }
  };
  document.getElementById('replayStart').addEventListener('click', () => { if (replayTimer) return; if (replayState.minute >= 90) { replayState.minute = 0; replayState.home = 0; replayState.away = 0; replayState.nextEvent = 0; document.getElementById('replayFeed').innerHTML = ''; } replayTimer = setInterval(tick, Number(document.getElementById('replaySpeed').value)); });
  document.getElementById('replayPause').addEventListener('click', () => { clearInterval(replayTimer); replayTimer = null; });
  document.getElementById('replaySkip').addEventListener('click', async () => { clearInterval(replayTimer); replayTimer = null; while (replayState.minute < 90) tick(); if (revealRequired) await finish('skip_to_full_time'); });
  document.getElementById('replaySpeed').addEventListener('change', () => { if (replayTimer) { clearInterval(replayTimer); replayTimer = setInterval(tick, Number(document.getElementById('replaySpeed').value)); } });
}

async function openMatchCentre(fixtureId) {
  const modal = ensureMatchCentre(); modal.hidden = false;
  modal.querySelector('#matchCentreContent').innerHTML = '<div class="match-centre-loading">CONNECTING TO MATCH ARCHIVE…</div>';
  const response = await fetch(`/api/match-centre?fixture_id=${encodeURIComponent(fixtureId)}`, { headers: { authorization: matchCentreAuth } });
  const data = await response.json();
  if (!response.ok) { modal.querySelector('#matchCentreContent').innerHTML = `<div class="match-centre-error">${mcEscape(data.error || 'Could not load match report')}</div>`; return; }
  renderMatchCentre(data);
}
document.addEventListener('click', (event) => { const target = event.target.closest('[data-match-centre]'); if (!target) return; event.preventDefault(); openMatchCentre(target.dataset.matchCentre); });
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeMatchCentre(); const target = event.target.closest?.('[data-match-centre]'); if (target && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); openMatchCentre(target.dataset.matchCentre); } });
