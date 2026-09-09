// Controlled-alpha containment for Match Centre browser/runtime stability.
// Loaded after phase2d4.js and before the player-link decorator wrapper.

const guardedFetch = window.fetch.bind(window);
let latestMatchCentrePayload = null;

const requestUrl = (input) => typeof input === 'string'
  ? input
  : input instanceof Request
    ? input.url
    : '';

const isMatchCentreResponse = (url) => url.includes('/api/match-centre?') || url.includes('/api/match-centre-linked?');

function teardownVisibleReplay() {
  const modal = document.getElementById('matchCentreModal');
  if (!modal || modal.hidden) return false;
  const close = modal.querySelector('#closeMatchCentre');
  if (!close) return false;
  close.click();
  latestMatchCentrePayload = null;
  return true;
}

function compactMatchCentrePayload(payload) {
  if (!payload || typeof payload !== 'object' || !payload.result || typeof payload.result !== 'object') return payload;

  const result = payload.result;
  const compactResult = {
    ...(result.statistics ? { statistics: result.statistics } : {}),
    ...(result.model ? { model: result.model } : {}),
    ...(Array.isArray(result.control_trajectory) ? { control_trajectory: result.control_trajectory } : {})
  };

  return { ...payload, result: compactResult };
}

function replayTrajectory(payload = latestMatchCentrePayload) {
  const rows = payload?.result?.control_trajectory;
  return Array.isArray(rows) && rows.length ? rows : null;
}

function replayMinute() {
  const raw = document.getElementById('replayClock')?.textContent || '0';
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? Math.max(0, Math.min(90, value)) : 0;
}

function possessionPoint(rows, minute) {
  let point = rows[0];
  for (const candidate of rows) {
    if (Number(candidate.minute) > minute) break;
    point = candidate;
  }
  const home = Math.max(25, Math.min(75, Number(point?.home) || 50));
  return { home: Math.round(home), away: 100 - Math.round(home) };
}

function ensureReplayPossessionBar() {
  const rows = replayTrajectory();
  const console = document.querySelector('#matchCentreModal:not([hidden]) .replay-console');
  if (!rows || !console) return null;
  let bar = console.querySelector('#replayPossession');
  if (bar) return bar;
  const fixture = latestMatchCentrePayload?.fixture || {};
  bar = document.createElement('div');
  bar.id = 'replayPossession';
  bar.className = 'replay-possession';
  bar.setAttribute('aria-live', 'polite');
  bar.innerHTML = `<div class="replay-possession-heading"><span>POSSESSION</span><b id="replayPossessionScore">50–50</b></div><div class="replay-possession-labels"><span>${String(fixture.home_club_name || 'HOME')}</span><span>${String(fixture.away_club_name || 'AWAY')}</span></div><div class="replay-possession-track" role="img" aria-label="Live possession"><span id="replayPossessionHome" class="replay-possession-home"></span><span class="replay-possession-away"></span></div>`;
  const score = console.querySelector('.replay-score');
  if (score?.nextSibling) console.insertBefore(bar, score.nextSibling);
  else console.prepend(bar);
  return bar;
}

function updateReplayPossessionBar() {
  const rows = replayTrajectory();
  const bar = ensureReplayPossessionBar();
  if (!rows || !bar) return;
  const point = possessionPoint(rows, replayMinute());
  const home = bar.querySelector('#replayPossessionHome');
  const score = bar.querySelector('#replayPossessionScore');
  const track = bar.querySelector('.replay-possession-track');
  const width = `${point.home}%`;
  const scoreText = `${point.home}–${point.away}`;
  const ariaLabel = `Live possession ${point.home} to ${point.away}`;
  if (home && home.style.width !== width) home.style.width = width;
  if (score && score.textContent !== scoreText) score.textContent = scoreText;
  if (track && track.getAttribute('aria-label') !== ariaLabel) track.setAttribute('aria-label', ariaLabel);
}

const jsonErrorResponse = (message, code, status = 503) => new Response(JSON.stringify({
  error: message,
  code
}), {
  status,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
});

window.fetch = async (input, init) => {
  const url = requestUrl(input);
  const matchCentreRequest = isMatchCentreResponse(url);
  let response;

  try {
    response = await guardedFetch(input, init);
  } catch (error) {
    if (!matchCentreRequest) throw error;
    return jsonErrorResponse(
      'Could not reach the match archive. Check your connection and try again.',
      'match_centre_fetch_failed',
      503
    );
  }

  if (!matchCentreRequest) return response;

  if (!response.ok) {
    try {
      await response.clone().json();
      return response;
    } catch {
      return jsonErrorResponse(
        `Could not load the match report (${response.status || 'server error'}). Please try again.`,
        'match_centre_invalid_error_response',
        Number(response.status) >= 400 ? Number(response.status) : 502
      );
    }
  }

  try {
    const payload = await response.clone().json();
    const compact = compactMatchCentrePayload(payload);
    latestMatchCentrePayload = compact;
    queueMicrotask(updateReplayPossessionBar);
    return new Response(JSON.stringify(compact), {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers
    });
  } catch {
    return jsonErrorResponse(
      'The match archive returned an unreadable response. Please try again.',
      'match_centre_invalid_success_response',
      502
    );
  }
};

document.addEventListener('click', (event) => {
  if (event.target.closest?.('[data-match-centre]')) teardownVisibleReplay();
}, true);

document.addEventListener('keydown', (event) => {
  if (!['Enter', ' '].includes(event.key)) return;
  if (event.target.closest?.('[data-match-centre]')) teardownVisibleReplay();
}, true);

const replayObserver = new MutationObserver(() => updateReplayPossessionBar());
replayObserver.observe(document.documentElement, { subtree: true, childList: true, characterData: true });

window.addEventListener('pagehide', teardownVisibleReplay);

export { compactMatchCentrePayload, teardownVisibleReplay, possessionPoint };