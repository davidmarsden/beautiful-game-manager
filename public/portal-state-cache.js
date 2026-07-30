const networkFetch = window.fetch.bind(window);
let bootstrapSnapshot = null;
let bootstrapRequest = null;
let bootstrapGeneration = 0;

const requestUrl = (input) => typeof input === 'string' ? input : input?.url || '';
const requestMethod = (input, init = {}) => String(init.method || input?.method || 'GET').toUpperCase();
const isBootstrap = (input, init) => requestMethod(input, init) === 'GET' && requestUrl(input).includes('/api/bootstrap');
const isDecisionWrite = (input, init) => requestMethod(input, init) === 'POST' && requestUrl(input).includes('/api/decisions');
const retryableDecisionStatus = (status) => status === 408 || status === 429 || status >= 500;
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

async function retryDecisionAfterAmbiguity(input, init) {
  const retryResponse = await networkFetch(input, init);
  if (!retryResponse.ok && !retryableDecisionStatus(retryResponse.status)) {
    throw new Error(`Decision retry returned HTTP ${retryResponse.status} after an ambiguous first attempt.`);
  }
  return retryResponse;
}

async function fetchDecisionWithRetry(input, init) {
  let firstResponse;
  try {
    firstResponse = await networkFetch(input, init);
  } catch {
    return retryDecisionAfterAmbiguity(input, init);
  }
  if (!retryableDecisionStatus(firstResponse.status)) return firstResponse;
  return retryDecisionAfterAmbiguity(input, init);
}

function orderedVisiblePlayerIds(selector) {
  return [...document.querySelectorAll(selector)]
    .map((slot) => String(slot.querySelector('.player-token')?.dataset.playerId || '').trim())
    .filter(Boolean);
}

function reorderCheckedLabels(containerId, orderedIds) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const labels = [...container.querySelectorAll('.player-pick')];
  orderedIds.forEach((id) => {
    const label = labels.find((item) => String(item.querySelector('input')?.value || '').trim() === id);
    if (label) container.appendChild(label);
  });
  labels
    .filter((label) => !orderedIds.includes(String(label.querySelector('input')?.value || '').trim()))
    .forEach((label) => container.appendChild(label));
}

function synchronizeLegacySelectorsFromVisibleBoard(event) {
  if (event.target?.id !== 'decisionForm') return;
  const board = document.getElementById('interactiveFormationBoard');
  if (!board?.isConnected) return;

  const startingXi = orderedVisiblePlayerIds('#formationPitch .formation-slot');
  const bench = orderedVisiblePlayerIds('#formationBench .bench-slot');
  if (startingXi.length !== 11 || bench.length !== 7) return;

  document.querySelectorAll('input[data-zone="xi"]').forEach((input) => {
    input.checked = startingXi.includes(String(input.value || '').trim());
  });
  document.querySelectorAll('input[data-zone="bench"]').forEach((input) => {
    input.checked = bench.includes(String(input.value || '').trim());
  });
  reorderCheckedLabels('startingXi', startingXi);
  reorderCheckedLabels('bench', bench);
}

window.tbgInvalidateBootstrapCache = invalidateBootstrapCache;
document.addEventListener('submit', synchronizeLegacySelectorsFromVisibleBoard, true);

window.fetch = async (input, init = {}) => {
  if (invalidatesBootstrap(input, init)) invalidateBootstrapCache();

  if (isDecisionWrite(input, init)) return fetchDecisionWithRetry(input, init);
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