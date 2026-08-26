(() => {
  const upstreamFetch = window.fetch.bind(window);
  const MAX_SECONDARY_CONCURRENCY = 2;
  const queue = [];
  let activeSecondary = 0;
  let bootstrapState = 'waiting';
  let bootstrapInFlight = null;

  window.tbgPortalAuthorization = window.tbgPortalAuthorization || '';

  const requestDetails = (args) => {
    const input = args[0];
    const init = args[1] || {};
    const requestUrl = typeof input === 'string' ? input : input?.url;
    const url = requestUrl ? new URL(requestUrl, window.location.href) : null;
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    if (init.headers) new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    return {
      url,
      authorization: headers.get('authorization') || '',
      method: String(init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase()
    };
  };

  const unavailableResponse = (status = 503) => new Response(JSON.stringify({
    error: 'Portal bootstrap is unavailable; secondary portal requests were suppressed to protect the service.',
    code: 'portal_bootstrap_unavailable'
  }), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
  });

  const failQueuedRequests = (status = 503) => {
    while (queue.length) queue.shift().resolve(unavailableResponse(status));
  };

  const drain = () => {
    if (bootstrapState !== 'ready') return;
    while (activeSecondary < MAX_SECONDARY_CONCURRENCY && queue.length) {
      const task = queue.shift();
      activeSecondary += 1;
      upstreamFetch(...task.args)
        .then(task.resolve, task.reject)
        .finally(() => {
          activeSecondary -= 1;
          drain();
        });
    }
  };

  const queueSecondaryRequest = (args) => new Promise((resolve, reject) => {
    queue.push({ args, resolve, reject });
    drain();
  });

  const coordinatedBootstrap = async (args) => {
    if (!bootstrapInFlight) {
      bootstrapState = 'loading';
      bootstrapInFlight = upstreamFetch(...args)
        .then((response) => {
          bootstrapState = response.ok ? 'ready' : 'failed';
          if (response.ok) drain();
          else failQueuedRequests(response.status || 503);
          return response;
        })
        .catch((error) => {
          bootstrapState = 'failed';
          failQueuedRequests(503);
          throw error;
        })
        .finally(() => {
          bootstrapInFlight = null;
        });
    }

    const response = await bootstrapInFlight;
    return response.clone();
  };

  window.fetch = async (...args) => {
    const details = requestDetails(args);
    if (details.authorization) window.tbgPortalAuthorization = details.authorization;

    const protectedPortalRequest = Boolean(
      details.url
      && details.url.origin === window.location.origin
      && details.url.pathname.startsWith('/api/')
      && details.authorization
    );

    if (!protectedPortalRequest) return upstreamFetch(...args);

    if (details.url.pathname === '/api/bootstrap' && details.method === 'GET') {
      return coordinatedBootstrap(args);
    }

    if (bootstrapState === 'failed') return unavailableResponse();
    return queueSecondaryRequest(args);
  };
})();
