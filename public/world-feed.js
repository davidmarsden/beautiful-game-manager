let feedLoadedAt = 0;
let feedLoading = null;
const FEED_TTL = 15_000;

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
    matchday_completed: 'Results'
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

function commentNode(comment) {
  const row = el('article', 'world-feed-comment');
  const meta = el('div', 'world-feed-comment-meta');
  const identity = comment.club_name ? `${comment.manager_name || 'Manager'} · ${comment.club_name}` : (comment.manager_name || 'Manager');
  meta.append(el('strong', '', identity), el('time', '', timeLabel(comment.created_at)));
  row.append(meta, el('p', '', comment.body || ''));
  return row;
}

function itemNode(item) {
  const card = el('article', `world-feed-item world-feed-${item.item_type || 'world'}`);
  const top = el('div', 'world-feed-item-top');
  const badge = el('span', 'world-feed-type', typeLabel(item.item_type));
  const when = el('time', '', timeLabel(item.created_at));
  top.append(badge, when);

  const title = el('h3', '', item.title || 'World update');
  const identity = item.actor_manager_name
    ? el('p', 'world-feed-identity', `${item.actor_manager_name}${item.actor_club_name ? ` · ${item.actor_club_name}` : ''}`)
    : null;
  const body = el('p', 'world-feed-body', item.body || '');
  body.style.whiteSpace = 'pre-line';

  card.append(top, title);
  if (identity) card.append(identity);
  card.append(body);

  const comments = el('section', 'world-feed-comments');
  const rows = Array.isArray(item.comments) ? item.comments : [];
  const heading = el('div', 'world-feed-comments-heading', `${rows.length} ${rows.length === 1 ? 'comment' : 'comments'}`);
  comments.append(heading);
  rows.forEach((comment) => comments.append(commentNode(comment)));

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
  form.append(input, button, status);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const message = input.value.trim();
    if (!message) return;
    button.disabled = true;
    status.textContent = 'Posting…';
    try {
      await sendFeedAction({ action: 'comment', feed_item_id: item.id, body: message });
      input.value = '';
      status.textContent = '';
      await loadWorldFeed({ force: true });
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
      await sendFeedAction({ action: 'post', body: message });
      textarea.value = '';
      status.textContent = '';
      await loadWorldFeed({ force: true });
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
}

async function loadWorldFeed({ force = false } = {}) {
  const root = host();
  if (!root) return;
  if (!force && Date.now() - feedLoadedAt < FEED_TTL) return;
  if (feedLoading) return feedLoading;
  feedLoading = (async () => {
    const token = feedToken();
    if (!token) {
      root.innerHTML = '<div class="empty-state">Sign in to view the World Feed.</div>';
      return;
    }
    root.innerHTML = '<div class="empty-state">Loading World Feed…</div>';
    const response = await fetch('/api/world-feed', { headers: { authorization: `Bearer ${token}` } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Could not load World Feed');
    renderFeed(data);
    feedLoadedAt = Date.now();
  })().catch((error) => {
    const current = host();
    if (current) {
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
