const networkFetch = window.fetch.bind(window);
let bootstrapSnapshot = null;
let bootstrapRequest = null;
let bootstrapGeneration = 0;

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

function invalidateBootstrapCache() {
  bootstrapGeneration += 1;
  bootstrapSnapshot = null;
  bootstrapRequest = null;
}

async function fetchBootstrapSnapshot(input, init, generation) {
  const response = await networkFetch(input, init);
  const snapshot = {
    body: await response.text(),
    status: response.status,
    statusText: response.statusText,
    headers: [...response.headers.entries()]
  };
  if (response.ok && generation === bootstrapGeneration) bootstrapSnapshot = snapshot;
  return snapshot;
}

window.tbgInvalidateBootstrapCache = invalidateBootstrapCache;

window.fetch = async (input, init = {}) => {
  if (invalidatesBootstrap(input, init)) invalidateBootstrapCache();

  if (!isBootstrap(input, init)) return networkFetch(input, init);
  if (bootstrapSnapshot) return responseFromSnapshot(bootstrapSnapshot);

  const generation = bootstrapGeneration;
  if (!bootstrapRequest || bootstrapRequest.generation !== generation) {
    bootstrapRequest = {
      generation,
      promise: fetchBootstrapSnapshot(input, init, generation)
    };
  }

  const activeRequest = bootstrapRequest;
  try {
    const snapshot = await activeRequest.promise;
    return responseFromSnapshot(snapshot);
  } finally {
    if (bootstrapRequest === activeRequest) bootstrapRequest = null;
  }
};
