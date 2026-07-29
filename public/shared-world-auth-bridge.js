(() => {
  const upstreamFetch = window.fetch.bind(window);

  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    if (!url.includes('/api/shared-world')) return upstreamFetch(input, init);

    const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
    if (!headers.get('authorization') && window.tbgPortalAuthorization) {
      headers.set('authorization', window.tbgPortalAuthorization);
    }
    return upstreamFetch(input, { ...init, headers });
  };
})();