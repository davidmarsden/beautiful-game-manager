(() => {
  const upstreamFetch = window.fetch.bind(window);
  const MAX_SECONDARY_CONCURRENCY = 2;
  const queue = [];
  const authRefreshes = new Map();
  const authorizationWaiters = new Set();
  let activeSecondary = 0;
  let bootstrapState = 'waiting';
  let bootstrapInFlight = null;
  let requestSequence = 0;

  window.tbgPortalAuthorization = window.tbgPortalAuthorization || '';

  const currentAuthorization = () => String(window.tbgPortalAuthorization || '').trim();

  const publishAuthorization = (authorization) => {
    const normalized = String(authorization || '').trim();
    if (!normalized || normalized === currentAuthorization()) return normalized;
    window.tbgPortalAuthorization = normalized;
    authorizationWaiters.forEach((resolve) => resolve(normalized));
    authorizationWaiters.clear();
    window.dispatchEvent(new CustomEvent('tbg:portal-authorization', { detail: { authorization: normalized } }));
    return normalized;
  };

  const waitForAuthorization = (timeoutMs = 10_000) => {
    const current = currentAuthorization();
    if (current) return Promise.resolve(current);
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        authorizationWaiters.delete(onAuthorization);
        clearTimeout(timer);
        callback(value);
      };
      const onAuthorization = (authorization) => finish(resolve, authorization);
      const timer = window.setTimeout(
        () => finish(reject, new Error('Portal authorization was not available in time.')),
        Math.max(0, Number(timeoutMs) || 0)
      );
      authorizationWaiters.add(onAuthorization);
      const racedCurrent = currentAuthorization();
      if (racedCurrent) onAuthorization(racedCurrent);
    });
  };

  window.tbgPortalAuth = Object.freeze({
    authorization: currentAuthorization,
    waitForAuthorization
  });

  const requestDetails = async (args) => {
    const input = args[0];
    const init = args[1] || {};
    const requestUrl = typeof input === 'string' ? input : input?.url;
    const url = requestUrl ? new URL(requestUrl, window.location.href) : null;
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    if (init.headers) new Headers(init.headers).forEach((value, key) => headers.set(key, value));

    let body = init.body;
    let bodyComparable = typeof body === 'string';
    if (body === undefined && input instanceof Request) {
      try {
        body = await input.clone().text();
        bodyComparable = true;
      } catch {
        body = undefined;
        bodyComparable = false;
      }
    }

    return {
      url,
      authorization: headers.get('authorization') || '',
      priority: String(headers.get('x-tbg-priority') || '').trim().toLowerCase(),
      method: String(init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase(),
      body,
      bodyComparable
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

  const publishRefreshAuthorization = async (response) => {
    if (!response?.ok) return;
    try {
      const payload = await response.clone().json();
      if (payload?.access_token) publishAuthorization(`Bearer ${payload.access_token}`);
    } catch {
      // Auth refresh still succeeds even if an unexpected response body cannot be inspected.
    }
  };

  const coordinatedAuthRefresh = async (args, details) => {
    if (!details.bodyComparable) {
      const response = await upstreamFetch(...args);
      await publishRefreshAuthorization(response);
      return response;
    }
    const key = `${details.url.origin}|${String(details.body)}`;
    if (!authRefreshes.has(key)) {
      const refresh = upstreamFetch(...args)
        .then(async (response) => {
          await publishRefreshAuthorization(response);
          return response;
        })
        .finally(() => authRefreshes.delete(key));
      authRefreshes.set(key, refresh);
    }
    const response = await authRefreshes.get(key);
    return response.clone();
  };

  window.fetch = async (...args) => {
    const details = await requestDetails(args);

    const authRefreshRequest = Boolean(
      details.url
      && details.method === 'POST'
      && details.url.pathname.endsWith('/auth/v1/token')
      && details.url.searchParams.get('grant_type') === 'refresh_token'
    );
    if (authRefreshRequest) return coordinatedAuthRefresh(args, details);

    if (details.authorization) publishAuthorization(details.authorization);

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
