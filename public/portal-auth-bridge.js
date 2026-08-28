(() => {
  const upstreamFetch = window.fetch.bind(window);
  const MAX_SECONDARY_CONCURRENCY = 2;
  const queue = [];
  const authRefreshes = new Map();
  let activeSecondary = 0;
  let bootstrapState = 'waiting';
  let bootstrapInFlight = null;
  let requestSequence = 0;

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
      priority: String(headers.get('x-tbg-priority') || '').trim().toLowerCase(),
      method: String(init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase(),
      body: init.body
    };
  };

  const worldFeedAction = (details) => {
    if (details?.url?.pathname !== '/api/world-feed' || details.method !== 'POST') return '';
    if (typeof details.body !== 'string') return '';
    try {
      return String(JSON.parse(details.body)?.action || '').trim().toLowerCase();
    } catch {
      return '';
    }
  };

  const requestPriority = (details) => {
    if (['interactive', 'normal', 'background'].includes(details.priority)) return details.priority;

    // The World Feed's first-paint GET is user-facing and should not sit behind
    // portal background work. Projection sync and social metrics are explicitly
    // best-effort/background actions and should yield to interactive requests.
    if (details?.url?.pathname === '/api/world-feed') {
      if (details.method === 'GET') return 'interactive';
      if (['sync', 'activity'].includes(worldFeedAction(details))) return 'background';
      return 'interactive';
    }

    return 'normal';
  };

  const priorityRank = (priority) => ({ interactive: 0, normal: 1, background: 2 })[priority] ?? 1;

  const nextQueuedTask = () => {
    if (!queue.length) return null;
    let bestIndex = 0;
    for (let index = 1; index < queue.length; index += 1) {
      const best = queue[bestIndex];
      const candidate = queue[index];
      const rankDelta = priorityRank(candidate.priority) - priorityRank(best.priority);
      if (rankDelta < 0 || (rankDelta === 0 && candidate.sequence < best.sequence)) bestIndex = index;
    }
    return queue.splice(bestIndex, 1)[0];
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
      const task = nextQueuedTask();
      activeSecondary += 1;
      upstreamFetch(...task.args)
        .then(task.resolve, task.reject)
        .finally(() => {
          activeSecondary -= 1;
          drain();
        });
    }
  };

  const queueSecondaryRequest = (args, details) => new Promise((resolve, reject) => {
    queue.push({
      args,
      resolve,
      reject,
      priority: requestPriority(details),
      sequence: requestSequence++
    });
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

  const coordinatedAuthRefresh = async (args, details) => {
    const key = `${details.url.origin}|${String(details.body || '')}`;
    if (!authRefreshes.has(key)) {
      const refresh = upstreamFetch(...args).finally(() => authRefreshes.delete(key));
      authRefreshes.set(key, refresh);
    }
    const response = await authRefreshes.get(key);
    return response.clone();
  };

  window.fetch = async (...args) => {
    const details = requestDetails(args);
    if (details.authorization) window.tbgPortalAuthorization = details.authorization;

    const authRefreshRequest = Boolean(
      details.url
      && details.method === 'POST'
      && details.url.pathname.endsWith('/auth/v1/token')
      && details.url.searchParams.get('grant_type') === 'refresh_token'
    );
    if (authRefreshRequest) return coordinatedAuthRefresh(args, details);

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
    return queueSecondaryRequest(args, details);
  };
})();
