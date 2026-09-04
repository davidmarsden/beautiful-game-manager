const FAST_REPLAY_INTERVAL = '180';
const PENALTY_AWARD_PRIORITY = 110;
const presentationFetch = window.fetch.bind(window);

function syncFastReplayMode() {
  const modal = document.getElementById('matchCentreModal');
  const speed = document.getElementById('replaySpeed');
  if (!modal) return;
  modal.dataset.fastReplay = speed?.value === FAST_REPLAY_INTERVAL ? 'true' : 'false';
}

function requestPath(input) {
  try {
    const raw = typeof input === 'string' ? input : input?.url;
    return raw ? new URL(raw, window.location.href).pathname : '';
  } catch {
    return '';
  }
}

function preservePenaltyCausality(payload) {
  if (!Array.isArray(payload?.events)) return payload;
  let changed = false;
  const events = payload.events.map((event) => {
    const type = String(event?.event_type || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (type !== 'penalty_awarded' || !event?.replay_presentation?.major) return event;
    const currentPriority = Number(event.replay_presentation.priority) || 0;
    if (currentPriority >= PENALTY_AWARD_PRIORITY) return event;
    changed = true;
    return {
      ...event,
      replay_presentation: {
        ...event.replay_presentation,
        priority: PENALTY_AWARD_PRIORITY,
        sequence_role: event.replay_presentation.sequence_role || 'source'
      }
    };
  });
  return changed ? { ...payload, events } : payload;
}

window.fetch = async (...args) => {
  const response = await presentationFetch(...args);
  if (!response.ok || requestPath(args[0]) !== '/api/match-centre') return response;
  const payload = await response.clone().json().catch(() => null);
  if (!payload) return response;
  const orderedPayload = preservePenaltyCausality(payload);
  if (orderedPayload === payload) return response;
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return new Response(JSON.stringify(orderedPayload), {
    status: response.status,
    statusText: response.statusText,
    headers
  });
};

document.addEventListener('change', (event) => {
  if (event.target?.id === 'replaySpeed') syncFastReplayMode();
});

new MutationObserver(() => syncFastReplayMode())
  .observe(document.documentElement, { childList: true, subtree: true });

window.addEventListener('tbg:match-revealed', syncFastReplayMode);
queueMicrotask(syncFastReplayMode);
