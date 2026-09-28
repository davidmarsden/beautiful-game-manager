(() => {
  const startedAt = performance.now();
  const nativeFetch = window.fetch.bind(window);
  const requests = [];
  const marks = { navigation_start: 0 };
  let sequence = 0;

  const byteLength = (value) => {
    if (value == null) return 0;
    try { return new TextEncoder().encode(String(value)).byteLength; } catch { return String(value).length; }
  };

  const endpointOf = (input) => {
    const raw = typeof input === 'string' ? input : input?.url || '';
    try {
      const url = new URL(raw, window.location.href);
      return url.origin === window.location.origin ? url.pathname : url.origin + url.pathname;
    } catch { return raw; }
  };

  const recordMark = (name) => {
    marks[name] = Math.round((performance.now() - startedAt) * 10) / 10;
  };

  window.tbgPerformance = Object.freeze({
    mark: recordMark,
    snapshot() {
      return {
        marks: { ...marks },
        requests: requests.map((request) => ({ ...request })),
        totals: {
          requests: requests.length,
          bootstrap_requests: requests.filter((request) => request.endpoint === '/api/bootstrap').length,
          response_bytes: requests.reduce((sum, request) => sum + (request.response_bytes || 0), 0)
        }
      };
    },
    report() {
      const snapshot = this.snapshot();
      console.group('[TBG performance observatory]');
      console.table(snapshot.requests);
      console.table(snapshot.marks);
      console.table(snapshot.totals);
      console.groupEnd();
      return snapshot;
    }
  });

  window.fetch = async (...args) => {
    const id = ++sequence;
    const input = args[0];
    const init = args[1] || {};
    const endpoint = endpointOf(input);
    const method = String(init.method || input?.method || 'GET').toUpperCase();
    const requestStarted = performance.now();
    const request = {
      id,
      endpoint,
      method,
      started_ms: Math.round((requestStarted - startedAt) * 10) / 10,
      request_bytes: byteLength(init.body),
      status: null,
      duration_ms: null,
      response_bytes: null,
      server_timing: ''
    };
    requests.push(request);
    try {
      const response = await nativeFetch(...args);
      request.status = response.status;
      request.duration_ms = Math.round((performance.now() - requestStarted) * 10) / 10;
      request.server_timing = response.headers.get('server-timing') || '';
      response.clone().text().then((body) => { request.response_bytes = byteLength(body); }).catch(() => {});
      return response;
    } catch (error) {
      request.status = 'network-error';
      request.duration_ms = Math.round((performance.now() - requestStarted) * 10) / 10;
      throw error;
    }
  };

  document.addEventListener('DOMContentLoaded', () => recordMark('dom_content_loaded'), { once: true });
  window.addEventListener('load', () => recordMark('window_load'), { once: true });
  window.addEventListener('tbg:portal-authorization', () => recordMark('authorization_ready'), { once: true });
  window.addEventListener('tbg:portal-rendered', () => recordMark('portal_rendered'), { once: true });
})();