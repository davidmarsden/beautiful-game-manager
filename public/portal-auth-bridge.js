(() => {
  const upstreamFetch = window.fetch.bind(window);
  window.tbgPortalAuthorization = window.tbgPortalAuthorization || '';
  window.fetch = async (...args) => {
    const headers = args[1]?.headers || (args[0] instanceof Request ? args[0].headers : null);
    const auth = headers instanceof Headers ? headers.get('authorization') : headers?.authorization;
    if (auth) window.tbgPortalAuthorization = auth;
    return upstreamFetch(...args);
  };
})();
