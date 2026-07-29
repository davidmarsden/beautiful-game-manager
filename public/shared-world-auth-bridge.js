(() => {
  const upstreamFetch = window.fetch.bind(window);
  const AUTH_PRIME_URL = 'tbg://prime-shared-world-authorization';

  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    if (url === AUTH_PRIME_URL) return new Response(null, { status: 204 });
    if (!url.includes('/api/shared-world')) return upstreamFetch(input, init);

    const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
    if (!headers.get('authorization') && window.tbgPortalAuthorization) {
      headers.set('authorization', window.tbgPortalAuthorization);
    }
    return upstreamFetch(input, { ...init, headers });
  };

  window.addEventListener('tbg:portal-rendered', () => {
    const authorization = window.tbgPortalAuthorization;
    if (!authorization) return;
    window.fetch(AUTH_PRIME_URL, { headers: { authorization } }).catch(() => {});
  });
})();