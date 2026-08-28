const $ = (id) => document.getElementById(id);
let latestMessages = [];
let decorating = false;

async function authorization() {
  if (!window.tbgPortalAuth?.waitForAuthorization) throw new Error('Portal authentication bridge is unavailable');
  return window.tbgPortalAuth.waitForAuthorization();
}

function setBadge(count) {
  const badge = $('inboxBadge');
  if (!badge) return;
  const unread = Math.max(0, Number(count) || 0);
  badge.textContent = unread;
  badge.hidden = unread === 0;
  badge.title = `${unread} unread message${unread === 1 ? '' : 's'}`;
}

function renderMessages(messages) {
  const list = $('inboxList');
  if (!list) return;
  latestMessages = messages || [];
  const unread = latestMessages.filter((message) => !message.read_at).length;
  setBadge(unread);

  const markAll = $('markAllInboxRead');
  if (markAll) markAll.disabled = unread === 0;

  list.innerHTML = latestMessages.length ? latestMessages.map((message) => {
    const unreadClass = message.read_at ? 'read' : 'unread';
    const action = message.read_at
      ? '<span class="message-read-label">Read</span>'
      : `<button type="button" class="mark-message-read" data-message-id="${message.id}">Mark as read</button>`;
    return `<article class="inbox-message ${unreadClass}" data-message-id="${message.id}" tabindex="0">
      <div class="message-heading"><span>${message.priority}</span>${action}</div>
      <h3>${message.subject}</h3>
      <p>${message.body}</p>
      <small>${new Date(message.created_at).toLocaleString()}</small>
    </article>`;
  }).join('') : '<p class="empty-state">No messages yet.</p>';
}

async function loadInbox() {
  const bearer = await authorization();
  const response = await fetch('/api/inbox', {
    headers: { authorization: bearer },
    cache: 'no-store'
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Could not load inbox');
  renderMessages(body.messages || []);
}

async function markRead(payload, button) {
  const bearer = await authorization();
  if (button) button.disabled = true;

  const response = await fetch('/api/inbox', {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      authorization: bearer
    },
    body: JSON.stringify(payload)
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Could not update inbox');

  const marked = new Set(body.message_ids || []);
  latestMessages = latestMessages.map((message) => marked.has(message.id)
    ? { ...message, read_at: body.read_at }
    : message);
  renderMessages(latestMessages);
}

function showInboxError(message) {
  const status = $('inboxStatus');
  if (!status) return;
  status.className = 'error';
  status.textContent = message;
}

document.addEventListener('click', async (event) => {
  const button = event.target.closest('.mark-message-read');
  if (button) {
    event.stopPropagation();
    try {
      await markRead({ message_id: button.dataset.messageId }, button);
    } catch (error) {
      button.disabled = false;
      showInboxError(error.message);
    }
    return;
  }

  if (event.target.closest('#markAllInboxRead')) {
    const markAll = $('markAllInboxRead');
    try {
      await markRead({ mark_all: true }, markAll);
    } catch (error) {
      markAll.disabled = false;
      showInboxError(error.message);
    }
    return;
  }

  const message = event.target.closest('.inbox-message.unread');
  if (message) {
    try {
      await markRead({ message_id: message.dataset.messageId });
    } catch (error) {
      showInboxError(error.message);
    }
  }
});

document.addEventListener('keydown', async (event) => {
  if (!['Enter', ' '].includes(event.key)) return;
  const message = event.target.closest('.inbox-message.unread');
  if (!message) return;
  event.preventDefault();
  try {
    await markRead({ message_id: message.dataset.messageId });
  } catch (error) {
    showInboxError(error.message);
  }
});

window.addEventListener('load', () => {
  setTimeout(() => loadInbox().catch((error) => showInboxError(error.message)), 700);

  const list = $('inboxList');
  if (!list) return;
  const observer = new MutationObserver(() => {
    if (decorating) return;
    const hasInteractiveMessages = Boolean(list.querySelector('[data-message-id]'));
    if (!hasInteractiveMessages && list.querySelector('.inbox-message')) {
      decorating = true;
      loadInbox().catch((error) => showInboxError(error.message)).finally(() => { decorating = false; });
    }
  });
  observer.observe(list, { childList: true });
});
