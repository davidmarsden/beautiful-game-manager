// Controlled-alpha containment for Match Centre browser/runtime stability.
// Loaded after phase2d4.js and before the player-link decorator wrapper.

const guardedFetch = window.fetch.bind(window);

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
  // Use the Match Centre's own close handler so its private replay timer/state
  // are cleared before a second archive can replace the DOM.
  close.click();
  return true;
}

function compactMatchCentrePayload(payload) {
  if (!payload || typeof payload !== 'object' || !payload.result || typeof payload.result !== 'object') return payload;

  // phase2d4.js only needs statistics/model from result after the server has
  // already projected events, submissions, summaries and performances. Drop
  // the duplicate heavyweight branches before the payload is retained by the
  // replay state and player-link decorator.
  const result = payload.result;
  const compactResult = {
    ...(result.statistics ? { statistics: result.statistics } : {}),
    ...(result.model ? { model: result.model } : {})
  };

  return { ...payload, result: compactResult };
}

window.fetch = async (input, init) => {
  const url = requestUrl(input);
  const response = await guardedFetch(input, init);
  if (!response.ok || !isMatchCentreResponse(url)) return response;

  try {
    const payload = await response.clone().json();
    const compact = compactMatchCentrePayload(payload);
    return new Response(JSON.stringify(compact), {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers
    });
  } catch {
    return response;
  }
};

// A second replay launch must synchronously tear down the current replay before
// phase2d4's bubbling click/keydown handler opens the next archive.
document.addEventListener('click', (event) => {
  if (event.target.closest?.('[data-match-centre]')) teardownVisibleReplay();
}, true);

document.addEventListener('keydown', (event) => {
  if (!['Enter', ' '].includes(event.key)) return;
  if (event.target.closest?.('[data-match-centre]')) teardownVisibleReplay();
}, true);

// Page lifecycle transitions should never leave a replay interval alive in a
// backgrounded document.
window.addEventListener('pagehide', teardownVisibleReplay);

export { compactMatchCentrePayload, teardownVisibleReplay };
