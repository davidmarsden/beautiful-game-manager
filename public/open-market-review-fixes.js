const nativeOpenMarketFetch = window.fetch.bind(window);
const SIGN_REQUEST_PREFIX = 'tbg:free-agent-sign-request:';
const RESTORE_TRANSFERS_KEY = 'tbg:restore-transfers-after-signing';

function requestUrl(input) {
  return new URL(typeof input === 'string' ? input : input?.url || '', window.location.href);
}

function requestMethod(input, init = {}) {
  return String(init.method || (input instanceof Request ? input.method : 'GET') || 'GET').toUpperCase();
}

function requestHeaders(input, init = {}) {
  return new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
}

function parseJsonBody(input, init = {}) {
  const body = init.body ?? (input instanceof Request ? null : undefined);
  if (typeof body !== 'string') return null;
  try { return JSON.parse(body); }
  catch { return null; }
}

function signingStorageKey(playerId) {
  return `${SIGN_REQUEST_PREFIX}${String(playerId || '').trim()}`;
}

function stableSigningRequestId(playerId, proposedId) {
  const key = signingStorageKey(playerId);
  const existing = sessionStorage.getItem(key);
  if (existing) return existing;
  const value = String(proposedId || '').trim()
    || (window.crypto?.randomUUID ? window.crypto.randomUUID() : `${Date.now()}-${playerId}`);
  sessionStorage.setItem(key, value);
  return value;
}

async function currentWorldOwnedIdentities(headers) {
  const response = await nativeOpenMarketFetch('/api/history', {
    headers: { authorization: headers.get('authorization') || '' }
  });
  if (!response.ok) return { playerIds: new Set(), transfermarktIds: new Set() };
  const data = await response.json().catch(() => ({}));
  const playerIds = new Set();
  const transfermarktIds = new Set();
  for (const club of Object.values(data?.clubs || {})) {
    for (const player of club?.players || []) {
      const playerId = String(player?.tbg_player_id || player?.player_id || player?.id || '').trim();
      const tmId = String(player?.transfermarkt_id || player?.transfermarktId || '').trim();
      if (playerId) playerIds.add(playerId);
      if (tmId) transfermarktIds.add(tmId);
    }
  }
  return { playerIds, transfermarktIds };
}

async function filterFreeAgentResponse(response, headers) {
  if (!response.ok) return response;
  const data = await response.clone().json().catch(() => null);
  if (!data || !Array.isArray(data.players)) return response;
  const owned = await currentWorldOwnedIdentities(headers).catch(() => ({ playerIds: new Set(), transfermarktIds: new Set() }));
  const players = data.players.filter((player) => {
    const playerId = String(player?.tbg_player_id || player?.player_id || '').trim();
    const tmId = String(player?.transfermarkt_id || player?.transfermarktId || '').trim();
    return !(playerId && owned.playerIds.has(playerId)) && !(tmId && owned.transfermarktIds.has(tmId));
  });
  if (players.length === data.players.length) return response;
  const filtered = { ...data, count: players.length, players };
  return new Response(JSON.stringify(filtered), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers
  });
}

window.fetch = async (input, init = {}) => {
  const url = requestUrl(input);
  const method = requestMethod(input, init);
  const headers = requestHeaders(input, init);
  const isFreeAgents = url.pathname === '/api/free-agents' || url.pathname.endsWith('/.netlify/functions/free-agents');

  if (isFreeAgents && method === 'POST') {
    const body = parseJsonBody(input, init);
    if (body?.action === 'sign') {
      const playerId = String(body.player_id || body.playerId || '').trim();
      const clientRequestId = stableSigningRequestId(playerId, body.client_request_id || body.clientRequestId);
      const nextInit = {
        ...init,
        body: JSON.stringify({ ...body, client_request_id: clientRequestId })
      };
      const response = await nativeOpenMarketFetch(input, nextInit);
      if (response.ok) {
        sessionStorage.removeItem(signingStorageKey(playerId));
        sessionStorage.setItem(RESTORE_TRANSFERS_KEY, '1');
        window.setTimeout(() => window.location.reload(), 250);
      }
      return response;
    }
  }

  const response = await nativeOpenMarketFetch(input, init);
  if (isFreeAgents && method === 'GET') return filterFreeAgentResponse(response, headers);
  return response;
};

window.addEventListener('tbg:portal-rendered', () => {
  if (sessionStorage.getItem(RESTORE_TRANSFERS_KEY) !== '1') return;
  sessionStorage.removeItem(RESTORE_TRANSFERS_KEY);
  window.setTimeout(() => document.querySelector('[data-view="transfers"]')?.click(), 0);
});
