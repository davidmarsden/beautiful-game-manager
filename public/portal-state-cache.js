const networkFetch = window.fetch.bind(window);
let bootstrapBody = null;
let bootstrapStatus = 200;
let bootstrapHeaders = [['content-type', 'application/json'], ['cache-control', 'no-store']];
let bootstrapPromise = null;

const requestUrl = (input) => typeof input === 'string' ? input : input?.url || '';
const requestMethod = (input, init = {}) => String(init.method || input?.method || 'GET').toUpperCase();
const isBootstrap = (input, init) => requestMethod(input, init) === 'GET' && requestUrl(input).includes('/api/bootstrap');
const invalidatesBootstrap = (input, init) => {
  const method = requestMethod(input, init);
  const url = requestUrl(input);
  return method !== 'GET' && ['/api/decisions', '/api/shared-world', '/api/profile'].some((path) => url.includes(path));
};

function cachedResponse() {
  return new Response(bootstrapBody, { status: bootstrapStatus, headers: bootstrapHeaders });
}

window.fetch = async (input, init = {}) => {
  if (invalidatesBootstrap(input, init)) {
    bootstrapBody = null;
    bootstrapPromise = null;
  }

  if (!isBootstrap(input, init)) return networkFetch(input, init);
  if (bootstrapBody !== null) return cachedResponse();
  if (bootstrapPromise) {
    await bootstrapPromise;
    return cachedResponse();
  }

  bootstrapPromise = (async () => {
    const response = await networkFetch(input, init);
    const body = await response.clone().text();
    if (response.ok) {
      bootstrapBody = body;
      bootstrapStatus = response.status;
      bootstrapHeaders = [...response.headers.entries()];
    }
    return response;
  })();

  try {
    return await bootstrapPromise;
  } finally {
    bootstrapPromise = null;
  }
};

window.addEventListener('tbg:portal-rendered', (event) => {
  if (bootstrapBody === null && event.detail) bootstrapBody = JSON.stringify(event.detail);
});
