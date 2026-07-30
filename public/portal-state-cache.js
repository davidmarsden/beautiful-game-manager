const networkFetch = window.fetch.bind(window);
let bootstrapSnapshot = null;
let bootstrapPromise = null;

const requestUrl = (input) => typeof input === 'string' ? input : input?.url || '';
const requestMethod = (input, init = {}) => String(init.method || input?.method || 'GET').toUpperCase();
const isBootstrap = (input, init) => requestMethod(input, init) === 'GET' && requestUrl(input).includes('/api/bootstrap');
const invalidatesBootstrap = (input, init) => {
  const method = requestMethod(input, init);
  const url = requestUrl(input);
  return method !== 'GET' && ['/api/decisions', '/api/shared-world', '/api/profile'].some((path) => url.includes(path));
};

function responseFromSnapshot(snapshot) {
  return new Response(snapshot.body, {
    status: snapshot.status,
    statusText: snapshot.statusText,
    headers: snapshot.headers
  });
}

async function fetchBootstrapSnapshot(input, init) {
  const response = await networkFetch(input, init);
  const snapshot = {
    body: await response.text(),
    status: response.status,
    statusText: response.statusText,
    headers: [...response.headers.entries()]
  };
  if (response.ok) bootstrapSnapshot = snapshot;
  return snapshot;
}

window.fetch = async (input, init = {}) => {
  if (invalidatesBootstrap(input, init)) {
    bootstrapSnapshot = null;
    bootstrapPromise = null;
  }

  if (!isBootstrap(input, init)) return networkFetch(input, init);
  if (bootstrapSnapshot) return responseFromSnapshot(bootstrapSnapshot);

  if (!bootstrapPromise) bootstrapPromise = fetchBootstrapSnapshot(input, init);
  try {
    const snapshot = await bootstrapPromise;
    return responseFromSnapshot(snapshot);
  } finally {
    bootstrapPromise = null;
  }
};

window.addEventListener('tbg:portal-rendered', (event) => {
  if (!bootstrapSnapshot && event.detail) {
    bootstrapSnapshot = {
      body: JSON.stringify(event.detail),
      status: 200,
      statusText: 'OK',
      headers: [['content-type', 'application/json'], ['cache-control', 'no-store']]
    };
  }
});
