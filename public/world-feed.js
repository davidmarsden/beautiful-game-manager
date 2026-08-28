import './manager-participation.js';

let feedLoadedAt = 0;
let feedLoading = null;
let feedCanModerate = false;
let feedManagerId = '';
let feedSyncAt = 0;
let feedSyncing = null;
const FEED_TTL = 15_000;
const FEED_SYNC_TTL = 60_000;

function feedToken() {
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key?.startsWith('sb-') || !key.endsWith('-auth-token')) continue;
    try {
      const stored = JSON.parse(localStorage.getItem(key));
      const token = stored?.access_token || stored?.currentSession?.access_token;
      if (token) return token;
    } catch {}
  }
  return '';
}

const host = () => document.getElementById('feedView');
const el = (tag, className = '', text = '') => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== '') node.textContent = text;
  return node;
};

function timeLabel(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

function typeLabel(type) {
  return ({
    manager_post: 'Manager',
    manager_appointment: 'Appointment',
    transfer_completed: 'Transfer',
    matchday_upcoming: 'Matchday',
    matchday_completed: 'Results',
    matchday_press_conference: 'Press conference'
  })[type] || 'World';
}

async function sendFeedAction(payload) {
  const token = feedToken();
  if (!token) throw new Error('Sign in to use the World Feed.');
  const response = await fetch('/api/world-feed', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'World Feed action failed');
  return data;
}

async function fetchFeedData(token) {
  const response = await fetch('/api/world-feed', { headers: { authorization: `Bearer ${token}` } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Could not load World Feed');
  return data;
}

function hasActiveFeedDraft() {
  const root = host();
  if (!root) return false;
  return [...root.querySelectorAll('.world-feed-composer textarea, .world-feed-comment-form textarea')]
    .some((field) => field === document.activeElement || field.value.trim() !== '');
}

function commentNode(comment, commentById, onReply) {
  const row = el('article', `world-feed-comment${comment.parent_comment_id ? ' world-feed-comment-reply' : ''}`);
  row.dataset.commentId = String(comment.id || '');
  const meta = el('div', 'world-feed-comment-meta');
  const identityText = comment.club_name ? `${comment.manager_name || 'Manager'} · ${comment.club_name}` : (comment.manager_name || 'Manager');
  const identity = el('strong', '', identityText);
  if (comment.manager_id) identity.dataset.managerProfileId = String(comment.manager_id);
  meta.append(identity, el('time', '', timeLabel(comment.created_at)));
  if (comment.id) {
    const reply = el('button', 'world-feed-reply-action', 'Reply');
    reply.type = 'button';
    reply.addEventListener('click', () => onReply(comment));
    meta.append(reply);
  }
  if (comment.parent_comment_id) {
    const parent = commentById.get(String(comment.parent_comment_id));
    row.append(el('small', 'world-feed-reply-context', `Reply to ${parent?.manager_name || 'manager'}`));
  }
  row.append(meta, el('p', '', comment.body || ''));
  return row;
}

function focusRequestedConversation() {
  const params = new URLSearchParams(window.location.search);
  const itemId = params.get('feed_item');
  const commentId = params.get('comment');
  if (!itemId) return;
  const card = host()?.querySelector(`[data-feed-item-id="${CSS.escape(itemId)}"]`);
  if (!card) return;
  const target = commentId
    ? card.querySelector(`[data-comment-id="${CSS.escape(commentId)}"]`) || card
    : card;
  target.classList.add('world-feed-notification-target');
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function firstUnpinnedCard(list) {
  return [...list.querySelectorAll('.world-feed-item')].find((card) => card.dataset.pinned !== 'true') || null;
}

function replaceFeedItem(item) {
  if (!item?.id) return false;
  const list = host()?.querySelector('.world-feed-list');
  if (!list) return false;
  const existing = list.querySelector(`[data-feed-item-id="${CSS.escape(String(item.id))}"]`);
  if (!existing) return false;

  const node = itemNode(item);
  if (item.pinned_at) {
    existing.replaceWith(node);
  } else {
    existing.remove();
    const firstUnpinned = firstUnpinnedCard(list);
    if (firstUnpinned) list.insertBefore(node, firstUnpinned);
    else list.append(node);
  }
  feedLoadedAt = Date.now();
  queueMicrotask(focusRequestedConversation);
  return true;
}

function prependFeedItem(item) {
  if (!item?.id) return false;
  const list = host()?.querySelector('.world-feed-list');
  if (!list) return false;
  list.querySelector('.empty-state')?.remove();
  const node = itemNode(item);
  const firstUnpinned = firstUnpinnedCard(list);
  if (item.pinned_at || !firstUnpinned) list.prepend(node);
  else list.insertBefore(node, firstUnpinned);
  feedLoadedAt = Date.now();
  return true;
}

function removeFeedItem(itemId) {
  const list = host()?.querySelector('.world-feed-list');
  const card = list?.querySelector(`[data-feed-item-id="${CSS.escape(String(itemId))}"]`);
  if (!card) return false;
  card.remove();
  if (!list.querySelector('.world-feed-item')) list.append(el('div', 'empty-state', 'No world activity yet. Make the first post.'));
  feedLoadedAt = Date.now();
  return true;
}

function itemNode(item) {
  const card = el('article', `world-feed-item world-feed-${item.item_type || 'world'}${item.pinned_at ? ' world-feed-pinned' : ''}`);
  card.dataset.feedItemId = item.id || '';
  card.dataset.pinned = item.pinned_at ? 'true' : 'false';

  const top = el('div', 'world-feed-item-top');
  const badges = el('div', 'world-feed-badges');
  badges.append(el('span', 'world-feed-type', typeLabel(item.item_type)));
  if (item.pinned_at) badges.append(el('span', 'world-feed-pin-badge', 'Pinned'));

  const topActions = el('div', 'world-feed-top-actions');
  if (feedCanModerate) {
    const pin = el('button', 'world-feed-pin-action', item.pinned_at ? 'Unpin' : 'Pin');
    pin.type = 'button';
    pin.addEventListener('click', async () => {
      pin.disabled = true;
      try {
        await sendFeedAction({ action: 'pin', feed_item_id: item.id, pinned: !item.pinned_at });
        await loadWorldFeed({ force: true });
      } catch (error) {
        pin.textContent = error.message;
      } finally {
        pin.disabled = false;
      }
    });
    topActions.append(pin);
  }

  const ownsManagerPost = item.item_type === 'manager_post'
    && String(item.actor_manager_id || '') === String(feedManagerId || '');
  if (feedCanModerate || ownsManagerPost) {
    const hide = el('button', 'world-feed-pin-action', 'Hide');
    hide.type = 'button';
    hide.addEventListener('click', async () => {
      if (!window.confirm('Hide this post from the World Feed?')) return;
      hide.disabled = true;
      try {
        await sendFeedAction({ action: 'hide', feed_item_id: item.id });
        if (!removeFeedItem(item.id)) await loadWorldFeed({ force: true });
      } catch (error) {
        hide.textContent = error.message;
        hide.disabled = false;
      }
    });
    topActions.append(hide);
  }

  topActions.append(el('time', '', timeLabel(item.created_at)));
  top.append(badges, topActions);

  const title = el('h3', '', item.title || 'World update');
  const identity = item.actor_manager_name
    ? el('p', 'world-feed-identity', `${item.actor_manager_name}${item.actor_club_name ? ` · ${item.actor_club_name}` : ''}`)
    : null;
  if (identity && item.actor_manager_id) identity.dataset.managerProfileId = String(item.actor_manager_id);
  const body = el('p', 'world-feed-body', item.body || '');
  body.style.whiteSpace = 'pre-line';

  card.append(top, title);
  if (identity) card.append(identity);
  card.append(body);

  const comments = el('section', 'world-feed-comments');
  const rows = Array.isArray(item.comments) ? item.comments : [];
  const commentById = new Map(rows.map((comment) => [String(comment.id || ''), comment]));
  const heading = el('div', 'world-feed-comments-heading', `${rows.length} ${rows.length === 1 ? 'comment' : 'comments'}`);
  comments.append(heading);

  const form = el('form', 'world-feed-comment-form');
  const input = document.createElement('textarea');
  input.name = 'comment';
  input.rows = 2;
  input.maxLength = 2000;
  input.required = true;
  input.placeholder = 'Comment as your manager…';
  const button = el('button', '', 'Comment');
  button.type = 'submit';
  const status = el('span', 'world-feed-inline-status');
  const cancelReply = el('button', 'world-feed-reply-cancel', 'Cancel reply');
  cancelReply.type = 'button';
  cancelReply.hidden = true;
  const clearReplyTarget = () => {
    delete input.dataset.parentCommentId;
    input.placeholder = 'Comment as your manager…';
    cancelReply.hidden = true;
    if (status.dataset.replyStatus === 'true') status.textContent = '';
    delete status.dataset.replyStatus;
  };
  const selectReplyTarget = (comment) => {
    input.dataset.parentCommentId = String(comment.id || '');
    input.placeholder = `Reply to ${comment.manager_name || 'manager'}…`;
    status.textContent = `Replying to ${comment.manager_name || 'manager'}`;
    status.dataset.replyStatus = 'true';
    cancelReply.hidden = false;
    input.focus();
  };
  cancelReply.addEventListener('click', clearReplyTarget);

  rows.forEach((comment) => comments.append(commentNode(comment, commentById, selectReplyTarget)));

  form.append(input, button, cancelReply, status);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const message = input.value.trim();
    if (!message) return;
    button.disabled = true;
    status.textContent = 'Posting…';
    delete status.dataset.replyStatus;
    try {
      const result = await sendFeedAction({
        action: 'comment',
        feed_item_id: item.id,
        body: message,
        parent_comment_id: input.dataset.parentCommentId || null
      });
      input.value = '';
      clearReplyTarget();
      status.textContent = '';
      if (!replaceFeedItem(result.item)) await loadWorldFeed({ force: true });
      document.dispatchEvent(new CustomEvent('tbg:world-feed-mutation-succeeded', { detail: { action: 'comment', feed_item_id: item.id, comment_id: result?.id || '' } }));
    } catch (error) {
      status.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
  comments.append(form);
  card.append(comments);
  return card;
}

function renderFeed(data) {
  const root = host();
  if (!root) return;
  root.replaceChildren();
  feedCanModerate = Boolean(data?.can_moderate);
  feedManagerId = String(data?.manager_id || '');

  const shell = el('section', 'world-feed-shell');
  const heading = el('div', 'world-feed-heading');
  const copy = el('div');
  copy.append(el('h2', '', 'World Feed'), el('p', '', 'The public life of the TBG world: matchdays, transfers, appointments and manager conversation. Your Manager Inbox remains private.'));
  const live = el('span', 'world-feed-live', 'LIVE WORLD');
  heading.append(copy, live);
  shell.append(heading);

  const composer = el('form', 'world-feed-composer');
  const composerTitle = el('strong', '', 'Post to the world');
  const textarea = document.createElement('textarea');
  textarea.rows = 3;
  textarea.maxLength = 4000;
  textarea.required = true;
  textarea.placeholder = 'Announcement, question, request, transfer interest…';
  const actions = el('div', 'world-feed-composer-actions');
  const status = el('span', 'world-feed-inline-status');
  const submit = el('button', '', 'Publish');
  submit.type = 'submit';
  actions.append(status, submit);
  composer.append(composerTitle, textarea, actions);
  composer.addEventListener('submit', async (event) => {
    event.preventDefault();
    const message = textarea.value.trim();
    if (!message) return;
    submit.disabled = true;
    status.textContent = 'Publishing…';
    try {
      const result = await sendFeedAction({ action: 'post', body: message });
      textarea.value = '';
      status.textContent = '';
      if (!prependFeedItem(result.item)) await loadWorldFeed({ force: true });
      document.dispatchEvent(new CustomEvent('tbg:world-feed-mutation-succeeded', { detail: { action: 'post', feed_item_id: result?.id || result?.item?.id || '' } }));
    } catch (error) {
      status.textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  });
  shell.append(composer);

  const list = el('div', 'world-feed-list');
  const items = Array.isArray(data?.items) ? data.items : [];
  if (!items.length) list.append(el('div', 'empty-state', 'No world activity yet. Make the first post.'));
  else items.forEach((item) => list.append(itemNode(item)));
  shell.append(list);
  root.append(shell);
  queueMicrotask(focusRequestedConversation);
}

async function refreshSystemProjection() {
  if (Date.now() - feedSyncAt < FEED_SYNC_TTL) return;
  if (feedSyncing) return feedSyncing;
  feedSyncing = (async () => {
    const token = feedToken();
    if (!token) return;
    const result = await sendFeedAction({ action: 'sync' });
    feedSyncAt = Date.now();
    if (!result?.changed) return;
    const data = await fetchFeedData(token);
    if (hasActiveFeedDraft()) {
      feedLoadedAt = 0;
      return;
    }
    renderFeed(data);
    feedLoadedAt = Date.now();
  })().catch(() => {
    // Projection reconciliation is deliberately best-effort: never replace a
    // usable feed with an error just because the background sync failed.
  }).finally(() => { feedSyncing = null; });
  return feedSyncing;
}

async function loadWorldFeed({ force = false } = {}) {
  const root = host();
  if (!root) return;
  const alreadyRendered = Boolean(root.querySelector('.world-feed-shell'));
  if (!force && Date.now() - feedLoadedAt < FEED_TTL) {
    void refreshSystemProjection();
    queueMicrotask(focusRequestedConversation);
    return;
  }
  if (feedLoading) return feedLoading;
  feedLoading = (async () => {
    const token = feedToken();
    if (!token) {
      root.innerHTML = '<div class="empty-state">Sign in to view the World Feed.</div>';
      return;
    }
    if (!alreadyRendered) root.innerHTML = '<div class="empty-state">Loading World Feed…</div>';
    const data = await fetchFeedData(token);
    if (alreadyRendered && hasActiveFeedDraft()) {
      feedLoadedAt = 0;
      return;
    }
    renderFeed(data);
    feedLoadedAt = Date.now();
    void refreshSystemProjection();
  })().catch((error) => {
    const current = host();
    if (current && !current.querySelector('.world-feed-shell')) {
      current.replaceChildren(el('div', 'empty-state', error.message));
    }
  }).finally(() => { feedLoading = null; });
  return feedLoading;
}

document.addEventListener('tbg:view-changed', (event) => {
  if (event.detail?.view === 'feed') loadWorldFeed({ force: false });
});
window.addEventListener('tbg:portal-rendered', () => {
  if (document.getElementById('feedView')?.classList.contains('active')) loadWorldFeed({ force: true });
});

export { loadWorldFeed };
