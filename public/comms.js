let overview = null;
let activeThread = null;
let loading = false;
let pendingSend = null;

async function authorization() {
  if (!window.tbgPortalAuth?.waitForAuthorization) throw new Error('Portal authentication bridge is unavailable');
  return window.tbgPortalAuth.waitForAuthorization();
}

function root() {
  return document.getElementById('commsView');
}

function query() {
  return new URLSearchParams(window.location.search);
}

function conversationFromUrl() {
  return query().get('conversation') || '';
}

function managerFromUrl() {
  return query().get('manager') || '';
}

function setCommsUrl({ conversation = '', manager = '' } = {}, push = true) {
  const url = new URL(window.location.href);
  url.searchParams.set('view', 'comms');
  if (conversation) url.searchParams.set('conversation', conversation);
  else url.searchParams.delete('conversation');
  if (manager) url.searchParams.set('manager', manager);
  else url.searchParams.delete('manager');
  history[push ? 'pushState' : 'replaceState']({}, '', url);
}

async function api(path = '', options = {}) {
  const bearer = await authorization();
  const response = await fetch(`/api/comms${path}`, {
    cache: 'no-store',
    ...options,
    headers: {
      authorization: bearer,
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Could not load messages');
  return body;
}

async function mutate(body) {
  return api('', { method: 'POST', body: JSON.stringify(body) });
}

function relativeTime(value) {
  const at = Date.parse(value || '');
  if (!Number.isFinite(at)) return '';
  const seconds = Math.max(0, Math.floor((Date.now() - at) / 1000));
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(at).toLocaleDateString();
}

function updateNavBadge() {
  const button = document.getElementById('commsNavButton');
  if (!button) return;
  const count = Number(overview?.unread_count || 0);
  button.innerHTML = count > 0
    ? `Messages <span class="comms-nav-badge">${count > 99 ? '99+' : count}</span>`
    : 'Messages';
}

function emptyThreadMarkup() {
  return '<div class="comms-empty-thread"><strong>Your private conversations live here.</strong><p>Choose a manager from the list, or use Message from the Managers page.</p></div>';
}

function renderShell() {
  const host = root();
  if (!host) return null;
  host.innerHTML = `
    <section class="comms-shell">
      <aside class="comms-sidebar">
        <header><div><small>PRIVATE</small><h2>Messages</h2></div><button type="button" data-comms-refresh aria-label="Refresh messages">↻</button></header>
        <p class="comms-principle">Conversation is social. Formal football actions still happen through TBG's structured controls.</p>
        <div class="comms-conversation-list"></div>
      </aside>
      <section class="comms-thread-panel" aria-live="polite">${emptyThreadMarkup()}</section>
    </section>`;
  host.querySelector('[data-comms-refresh]')?.addEventListener('click', () => void loadOverview({ forceThread: true }));
  return host;
}

function renderConversationList() {
  const host = root();
  const list = host?.querySelector('.comms-conversation-list');
  if (!list) return;
  list.replaceChildren();
  const conversations = Array.isArray(overview?.conversations) ? overview.conversations : [];
  if (!conversations.length) {
    list.innerHTML = '<p class="comms-empty-list">No private conversations yet.</p>';
    return;
  }
  for (const conversation of conversations) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `comms-conversation-row${activeThread?.id === conversation.id ? ' active' : ''}${Number(conversation.unread_count || 0) ? ' unread' : ''}`;
    button.dataset.conversationId = conversation.id;
    const identity = document.createElement('span');
    identity.className = 'comms-conversation-identity';
    const name = document.createElement('strong');
    name.textContent = conversation.other_manager_name || 'Manager';
    const club = document.createElement('small');
    club.textContent = conversation.other_club_name || conversation.other_club_id || 'No current club';
    identity.append(name, club);
    const preview = document.createElement('span');
    preview.className = 'comms-conversation-preview';
    preview.textContent = conversation.last_message?.body || 'Start the conversation';
    const meta = document.createElement('span');
    meta.className = 'comms-conversation-meta';
    const time = document.createElement('small');
    time.textContent = relativeTime(conversation.last_message?.created_at || conversation.created_at);
    meta.append(time);
    const unread = Number(conversation.unread_count || 0);
    if (unread) {
      const badge = document.createElement('b');
      badge.textContent = unread > 99 ? '99+' : String(unread);
      meta.append(badge);
    }
    button.append(identity, preview, meta);
    button.addEventListener('click', () => void openConversation(conversation.id, { push: true }));
    list.append(button);
  }
}

function createMessageNode(message, selfId) {
  const own = message.sender_manager_id === selfId;
  const article = document.createElement('article');
  article.className = `comms-message ${own ? 'own' : 'other'}`;
  article.dataset.messageId = message.id;
  const head = document.createElement('header');
  const who = document.createElement('strong');
  who.textContent = own ? 'You' : (message.sender_display_name || 'Manager');
  const context = document.createElement('small');
  context.textContent = [message.sender_club_name || message.sender_club_id || '', relativeTime(message.created_at)].filter(Boolean).join(' · ');
  head.append(who, context);
  const body = document.createElement('p');
  body.textContent = message.body || '';
  article.append(head, body);
  if (!own) {
    const actions = document.createElement('div');
    actions.className = 'comms-message-actions';
    const report = document.createElement('button');
    report.type = 'button';
    report.textContent = 'Report';
    report.addEventListener('click', () => void reportMessage(message));
    actions.append(report);
    article.append(actions);
  }
  return article;
}

function renderThread() {
  const host = root();
  const panel = host?.querySelector('.comms-thread-panel');
  if (!panel) return;
  panel.replaceChildren();
  if (!activeThread) {
    panel.innerHTML = emptyThreadMarkup();
    renderConversationList();
    return;
  }

  const participant = activeThread.participant || {};
  const header = document.createElement('header');
  header.className = 'comms-thread-header';
  const identity = document.createElement('div');
  const kicker = document.createElement('small');
  kicker.textContent = 'PRIVATE CONVERSATION';
  const name = document.createElement('h2');
  name.textContent = participant.manager_name || 'Manager';
  const club = document.createElement('p');
  club.textContent = participant.club_name || participant.club_id || 'No current club';
  identity.append(kicker, name, club);

  const controls = document.createElement('div');
  controls.className = 'comms-thread-controls';
  const mute = document.createElement('button');
  mute.type = 'button';
  mute.textContent = activeThread.muted ? 'Unmute' : 'Mute';
  mute.addEventListener('click', () => void toggleMute());
  const block = document.createElement('button');
  block.type = 'button';
  block.className = activeThread.blocked_by_me ? 'danger active' : 'danger';
  block.textContent = activeThread.blocked_by_me ? 'Unblock' : 'Block';
  block.addEventListener('click', () => void toggleBlock());
  controls.append(mute, block);
  header.append(identity, controls);

  const stream = document.createElement('div');
  stream.className = 'comms-message-stream';
  const messages = Array.isArray(activeThread.messages) ? activeThread.messages : [];
  if (!messages.length) stream.innerHTML = '<p class="comms-thread-empty">No messages yet. Say hello.</p>';
  else messages.forEach((message) => stream.append(createMessageNode(message, activeThread.manager_id)));

  const composer = document.createElement('form');
  composer.className = 'comms-composer';
  const textarea = document.createElement('textarea');
  textarea.name = 'message';
  textarea.rows = 3;
  textarea.maxLength = 4000;
  textarea.placeholder = activeThread.blocked_by_me ? 'Unblock this manager to send a message.' : 'Write a private message…';
  textarea.disabled = Boolean(activeThread.blocked_by_me);
  const footer = document.createElement('div');
  const note = document.createElement('small');
  note.textContent = 'Messages are not bids, promises or formal game actions.';
  const send = document.createElement('button');
  send.type = 'submit';
  send.textContent = 'Send';
  send.disabled = Boolean(activeThread.blocked_by_me);
  footer.append(note, send);
  composer.append(textarea, footer);
  composer.addEventListener('submit', (event) => void sendMessage(event, textarea, send));

  panel.append(header, stream, composer);
  renderConversationList();
  requestAnimationFrame(() => { stream.scrollTop = stream.scrollHeight; });
}

async function loadOverview({ forceThread = false } = {}) {
  if (loading) return;
  loading = true;
  try {
    overview = await api();
    updateNavBadge();
    if (!root()?.querySelector('.comms-shell')) renderShell();
    renderConversationList();
    const id = conversationFromUrl();
    if (id && (forceThread || activeThread?.id !== id)) await openConversation(id, { push: false });
    else if (!id) {
      activeThread = null;
      pendingSend = null;
      renderThread();
    }
  } catch (error) {
    const host = root();
    if (host) host.innerHTML = `<div class="empty-state">${error.message}</div>`;
  } finally {
    loading = false;
  }
}

async function openConversation(id, { push = false } = {}) {
  if (!id) return;
  try {
    activeThread = await api(`?conversation=${encodeURIComponent(id)}`);
    if (push) setCommsUrl({ conversation: id }, true);
    renderThread();
    const last = Number(activeThread.last_message_seq || 0);
    const read = Number(activeThread.last_read_message_seq || 0);
    if (last > read) {
      await mutate({ action: 'mark-read', conversation_id: id, message_seq: last });
      activeThread.last_read_message_seq = last;
      if (overview) {
        const item = overview.conversations?.find((row) => row.id === id);
        if (item) {
          overview.unread_count = Math.max(0, Number(overview.unread_count || 0) - Number(item.unread_count || 0));
          item.unread_count = 0;
          updateNavBadge();
          renderConversationList();
        }
      }
    }
  } catch (error) {
    const panel = root()?.querySelector('.comms-thread-panel');
    if (panel) panel.innerHTML = `<div class="comms-empty-thread"><strong>Conversation unavailable.</strong><p>${error.message}</p></div>`;
  }
}

async function startConversation(otherManagerId) {
  const result = await mutate({ action: 'start', other_manager_id: otherManagerId });
  if (!result.conversation_id) throw new Error('Could not open conversation');
  setCommsUrl({ conversation: result.conversation_id }, false);
  overview = await api();
  updateNavBadge();
  await openConversation(result.conversation_id, { push: false });
}

async function sendMessage(event, textarea, button) {
  event.preventDefault();
  const message = textarea.value.trim();
  if (!message || !activeThread?.id) return;
  button.disabled = true;
  textarea.disabled = true;
  try {
    const samePendingDraft = pendingSend
      && pendingSend.conversationId === activeThread.id
      && pendingSend.message === message;
    const requestKey = samePendingDraft
      ? pendingSend.requestKey
      : (globalThis.crypto?.randomUUID?.() || `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    pendingSend = { conversationId: activeThread.id, message, requestKey };

    const result = await mutate({
      action: 'send',
      conversation_id: activeThread.id,
      message,
      request_key: requestKey
    });
    activeThread = result.conversation || activeThread;
    textarea.value = '';
    pendingSend = null;
    overview = await api();
    updateNavBadge();
    renderThread();
  } catch (error) {
    window.alert(error.message);
  } finally {
    if (!activeThread?.blocked_by_me) {
      button.disabled = false;
      textarea.disabled = false;
      textarea.focus();
    }
  }
}

async function toggleMute() {
  if (!activeThread?.id) return;
  const muted = !activeThread.muted;
  await mutate({ action: 'mute', conversation_id: activeThread.id, muted });
  activeThread.muted = muted;
  const item = overview?.conversations?.find((row) => row.id === activeThread.id);
  if (item) item.muted = muted;
  renderThread();
}

async function toggleBlock() {
  if (!activeThread?.id || !activeThread.participant?.manager_id) return;
  const blocked = !activeThread.blocked_by_me;
  if (blocked && !window.confirm('Block this manager from ordinary private messages? Formal TBG game obligations will still be delivered separately.')) return;
  await mutate({
    action: 'block',
    conversation_id: activeThread.id,
    other_manager_id: activeThread.participant.manager_id,
    blocked
  });
  activeThread.blocked_by_me = blocked;
  const item = overview?.conversations?.find((row) => row.id === activeThread.id);
  if (item) item.blocked_by_me = blocked;
  renderThread();
}

async function reportMessage(message) {
  const reason = window.prompt('Report reason: harassment, spam, abuse, or other', 'other');
  if (!reason) return;
  const normalized = reason.trim().toLowerCase();
  if (!['harassment', 'spam', 'abuse', 'other'].includes(normalized)) {
    window.alert('Choose harassment, spam, abuse, or other.');
    return;
  }
  const details = window.prompt('Anything else the moderator should know? (optional)', '') ?? '';
  try {
    await mutate({
      action: 'report',
      conversation_id: activeThread.id,
      message_id: message.id,
      reason: normalized,
      details
    });
    window.alert('Report submitted.');
  } catch (error) {
    window.alert(error.message);
  }
}

async function openFromManager(managerId) {
  if (!managerId) return;
  try {
    await startConversation(managerId);
  } catch (error) {
    const panel = root()?.querySelector('.comms-thread-panel');
    if (panel) panel.innerHTML = `<div class="comms-empty-thread"><strong>Could not open conversation.</strong><p>${error.message}</p></div>`;
  }
}

document.addEventListener('tbg:view-changed', (event) => {
  if (event.detail?.view !== 'comms') return;
  if (!root()?.querySelector('.comms-shell')) renderShell();
  const managerId = managerFromUrl();
  if (managerId && !conversationFromUrl()) {
    setCommsUrl({ manager: managerId }, false);
    void openFromManager(managerId);
    return;
  }
  void loadOverview({ forceThread: true });
});

window.addEventListener('popstate', () => {
  if (!root() || root().hidden) return;
  void loadOverview({ forceThread: true });
});

window.addEventListener('tbg:portal-rendered', () => {
  overview = null;
  activeThread = null;
});

window.addEventListener('tbg:portal-refreshed', () => {
  if (root() && !root().hidden) void loadOverview({ forceThread: true });
});

export { loadOverview, openFromManager };
