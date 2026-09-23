let dialog = null;
let currentObject = null;
let discussion = null;

async function authorization() {
  if (!window.tbgPortalAuth?.waitForAuthorization) throw new Error('Portal authentication bridge is unavailable');
  return window.tbgPortalAuth.waitForAuthorization();
}

async function api(params, options = {}) {
  const bearer = await authorization();
  const url = new URL('/api/object-discussion', window.location.origin);
  if (!options.body) {
    url.searchParams.set('type', params.type);
    url.searchParams.set('id', params.id);
    url.searchParams.set('title', params.title);
  }
  const response = await fetch(url, {
    cache: 'no-store',
    ...options,
    headers: {
      authorization: bearer,
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Discussion unavailable');
  return body;
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
  return days < 7 ? `${days}d ago` : new Date(at).toLocaleDateString();
}

function ensureDialog() {
  if (dialog) return dialog;
  dialog = document.createElement('dialog');
  dialog.className = 'object-discussion-dialog';
  dialog.innerHTML = `
    <section class="object-discussion-card">
      <header>
        <div><small>PUBLIC DISCUSSION</small><h2></h2><p>Manager conversation attached to this TBG object. Discussion never changes game state.</p></div>
        <button type="button" data-close-object-discussion aria-label="Close discussion">×</button>
      </header>
      <div class="object-discussion-comments"></div>
      <form class="object-discussion-composer">
        <textarea rows="3" maxlength="2000" placeholder="Add to the discussion…"></textarea>
        <div><small>Public to managers in this world · not a formal football action.</small><button type="submit">Post</button></div>
        <p class="object-discussion-status" aria-live="polite"></p>
      </form>
    </section>`;
  document.body.append(dialog);
  dialog.querySelector('[data-close-object-discussion]').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
  dialog.querySelector('form').addEventListener('submit', submitComment);
  return dialog;
}

function renderComments() {
  const modal = ensureDialog();
  modal.querySelector('h2').textContent = discussion?.object_title || currentObject?.title || 'Discussion';
  const root = modal.querySelector('.object-discussion-comments');
  root.replaceChildren();
  const comments = Array.isArray(discussion?.comments) ? discussion.comments : [];
  if (!comments.length) {
    root.innerHTML = '<p class="object-discussion-empty">No comments yet. Start the discussion.</p>';
    return;
  }
  for (const comment of comments) {
    const article = document.createElement('article');
    article.className = 'object-discussion-comment';
    if (comment.parent_comment_id) article.classList.add('reply');
    article.dataset.commentId = comment.id;
    const head = document.createElement('header');
    const who = document.createElement('strong');
    who.textContent = comment.manager_name || 'Manager';
    const meta = document.createElement('small');
    meta.textContent = [comment.club_name || comment.club_id || '', relativeTime(comment.created_at)].filter(Boolean).join(' · ');
    head.append(who, meta);
    const body = document.createElement('p');
    body.textContent = comment.body || '';
    const reply = document.createElement('button');
    reply.type = 'button';
    reply.textContent = 'Reply';
    reply.addEventListener('click', () => {
      const form = modal.querySelector('form');
      form.dataset.parentCommentId = comment.id;
      const status = form.querySelector('.object-discussion-status');
      status.textContent = `Replying to ${comment.manager_name || 'manager'} · clear by posting or closing`;
      form.querySelector('textarea').focus();
    });
    article.append(head, body, reply);
    root.append(article);
  }
  root.scrollTop = root.scrollHeight;
}

async function submitComment(event) {
  event.preventDefault();
  if (!currentObject) return;
  const form = event.currentTarget;
  const textarea = form.querySelector('textarea');
  const button = form.querySelector('button[type="submit"]');
  const status = form.querySelector('.object-discussion-status');
  const body = textarea.value.trim();
  if (!body) return;
  button.disabled = true;
  textarea.disabled = true;
  status.textContent = 'Posting…';
  try {
    const result = await api(currentObject, {
      method: 'POST',
      body: JSON.stringify({
        action: 'comment',
        object_type: currentObject.type,
        object_id: currentObject.id,
        object_title: currentObject.title,
        body,
        parent_comment_id: form.dataset.parentCommentId || null
      })
    });
    discussion = result.discussion;
    textarea.value = '';
    delete form.dataset.parentCommentId;
    status.textContent = '';
    renderComments();
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
    textarea.disabled = false;
  }
}

async function openObjectDiscussion(object) {
  currentObject = object;
  discussion = null;
  const modal = ensureDialog();
  modal.querySelector('h2').textContent = object.title;
  modal.querySelector('.object-discussion-comments').innerHTML = '<p class="object-discussion-empty">Loading discussion…</p>';
  modal.querySelector('.object-discussion-status').textContent = '';
  modal.querySelector('form').removeAttribute('data-parent-comment-id');
  if (!modal.open) modal.showModal();
  try {
    discussion = await api(object);
    renderComments();
  } catch (error) {
    modal.querySelector('.object-discussion-comments').innerHTML = '<p class="object-discussion-empty"></p>';
    modal.querySelector('.object-discussion-empty').textContent = error.message;
  }
}

function actionButton(type, id, title) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'object-discussion-trigger';
  button.dataset.objectDiscussion = 'true';
  button.dataset.objectType = type;
  button.dataset.objectId = id;
  button.dataset.objectTitle = title;
  button.textContent = 'Discuss';
  return button;
}

function matchesAndDescendants(root, selector) {
  const nodes = [];
  if (root?.matches?.(selector)) nodes.push(root);
  root?.querySelectorAll?.(selector).forEach((node) => nodes.push(node));
  return nodes;
}

function addPlayerActions(root = document) {
  matchesAndDescendants(root, '.tbg-player-profile[data-player-id]').forEach((panel) => {
    if (panel.querySelector('[data-object-discussion][data-object-type="player"]')) return;
    const id = String(panel.dataset.playerId || '').trim();
    const title = panel.querySelector('h2,h1')?.textContent?.trim() || id;
    const nav = panel.querySelector('.tbg-profile-tabs');
    if (!id || !nav) return;
    nav.before(actionButton('player', id, title));
  });
}

function addClubActions(root = document) {
  matchesAndDescendants(root, '#historyClubPanel').forEach((panel) => {
    if (panel.querySelector('[data-object-discussion][data-object-type="club"]')) return;
    const id = String(panel.dataset.clubId || '').trim();
    const title = panel.querySelector('h2')?.textContent?.trim() || id;
    const heading = panel.querySelector('.section-heading');
    if (!id || !heading) return;
    heading.append(actionButton('club', id, title));
  });
}

function addFixtureActions(root = document) {
  matchesAndDescendants(root, '[data-match-centre]').forEach((trigger) => {
    const id = String(trigger.dataset.matchCentre || '').trim();
    if (!id) return;
    const existing = trigger.querySelector?.(`[data-object-discussion][data-object-type="fixture"][data-object-id="${CSS.escape(id)}"]`)
      || trigger.parentElement?.querySelector?.(`:scope > [data-object-discussion][data-object-type="fixture"][data-object-id="${CSS.escape(id)}"]`);
    if (existing) return;
    const title = (trigger.getAttribute('aria-label') || trigger.textContent || id).trim().replace(/\s+/g, ' ').slice(0, 240);
    const button = actionButton('fixture', id, title);

    if (trigger.tagName === 'TR') {
      let cell = trigger.querySelector('[data-fixture-discussion-cell]');
      if (!cell) {
        cell = document.createElement('td');
        cell.dataset.fixtureDiscussionCell = '';
        cell.className = 'fixture-discussion-cell';
        trigger.append(cell);
      }
      cell.append(button);
      return;
    }

    trigger.insertAdjacentElement('afterend', button);
  });
}

function addNewsActions(root = document) {
  matchesAndDescendants(root, '[data-feed-item-id]').forEach((card) => {
    if (card.querySelector('[data-object-discussion][data-object-type="news"]')) return;
    const id = String(card.dataset.feedItemId || '').trim();
    if (!id) return;
    const title = (card.querySelector('h3,h2,strong')?.textContent || 'News discussion').trim().replace(/\s+/g, ' ').slice(0, 240);
    card.append(actionButton('news', id, title));
  });
}

function decorate(root = document) {
  addPlayerActions(root);
  addClubActions(root);
  addFixtureActions(root);
  addNewsActions(root);
}

document.addEventListener('click', (event) => {
  const trigger = event.target.closest?.('[data-object-discussion]');
  if (!trigger) return;
  event.preventDefault();
  event.stopPropagation();
  const object = {
    type: String(trigger.dataset.objectType || '').trim(),
    id: String(trigger.dataset.objectId || '').trim(),
    title: String(trigger.dataset.objectTitle || '').trim()
  };
  if (!object.type || !object.id || !object.title) return;
  void openObjectDiscussion(object);
}, true);

const observer = new MutationObserver((records) => {
  for (const record of records) {
    record.addedNodes.forEach((node) => {
      if (node.nodeType === Node.ELEMENT_NODE) decorate(node);
    });
  }
});
observer.observe(document.documentElement, { childList: true, subtree: true });

window.addEventListener('tbg:portal-rendered', () => decorate(document));
document.addEventListener('tbg:view-changed', () => decorate(document));
decorate(document);

const deepLink = new URLSearchParams(window.location.search);
if (deepLink.get('discussion_type') && deepLink.get('discussion_id')) {
  window.addEventListener('tbg:portal-rendered', () => {
    void openObjectDiscussion({
      type: deepLink.get('discussion_type'),
      id: deepLink.get('discussion_id'),
      title: deepLink.get('discussion_id')
    });
  }, { once: true });
}

export { openObjectDiscussion };
