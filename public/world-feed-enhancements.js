const COMMENT_PREVIEW_LIMIT = 2;
const ACTIVITY_TTL = 5 * 60_000;
let activityLoadedAt = 0;
let activityLoading = null;
const expandAfterComment = new Set();

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

function commentLabel(count) {
  if (count === 0) return '0 comments';
  if (count === 1) return '1 comment';
  return `${count} comments`;
}

function setCommentExpansion(section, rows, toggle, expanded) {
  rows.forEach((row, index) => {
    row.hidden = !expanded && index < Math.max(0, rows.length - COMMENT_PREVIEW_LIMIT);
  });
  if (!toggle) return;
  toggle.setAttribute('aria-expanded', String(expanded));
  toggle.textContent = expanded ? 'Collapse comments' : `Show all ${rows.length} comments`;
}

function enhanceCommentSection(section) {
  if (!(section instanceof HTMLElement) || section.dataset.commentCollapseReady === 'true') return;
  section.dataset.commentCollapseReady = 'true';

  const rows = [...section.children].filter((node) => node.classList?.contains('world-feed-comment'));
  const heading = section.querySelector(':scope > .world-feed-comments-heading');
  if (heading) heading.textContent = commentLabel(rows.length);
  if (rows.length <= COMMENT_PREVIEW_LIMIT) return;

  const card = section.closest('.world-feed-item');
  const itemId = String(card?.dataset.feedItemId || '');
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'world-feed-comments-toggle';
  toggle.setAttribute('aria-expanded', 'false');
  if (heading) heading.after(toggle);
  else section.prepend(toggle);

  let expanded = expandAfterComment.delete(itemId);
  setCommentExpansion(section, rows, toggle, expanded);
  toggle.addEventListener('click', () => {
    expanded = toggle.getAttribute('aria-expanded') !== 'true';
    setCommentExpansion(section, rows, toggle, expanded);
  });
}

function enhanceComments(root = document) {
  root.querySelectorAll?.('.world-feed-comments').forEach(enhanceCommentSection);
}

function inactivityText(row) {
  if (!row?.last_social_activity_at) return 'No posts or comments yet';
  const days = Number(row.inactive_days);
  if (!Number.isFinite(days) || days <= 0) return 'Last contribution today';
  if (days === 1) return 'Last contribution 1 day ago';
  return `Last contribution ${days} days ago`;
}

function metric(label, value) {
  const node = document.createElement('span');
  node.className = 'world-feed-activity-metric';
  node.innerHTML = `<strong>${Number(value) || 0}</strong><small>${label}</small>`;
  return node;
}

function ensureActivityPanel() {
  const shell = document.querySelector('#feedView .world-feed-shell');
  if (!shell) return null;
  let panel = shell.querySelector('.world-feed-social-activity');
  if (panel) return panel;

  panel = document.createElement('section');
  panel.className = 'world-feed-social-activity';
  panel.innerHTML = '<div class="world-feed-activity-heading"><div><strong>Social activity</strong><small>Posts and comments only — not a measure of club management.</small></div><span>Loading…</span></div>';
  const composer = shell.querySelector('.world-feed-composer');
  if (composer) composer.after(panel);
  else shell.prepend(panel);
  return panel;
}

function managerActivityRow(row) {
  const node = document.createElement('div');
  node.className = 'world-feed-manager-activity-row';
  const identity = document.createElement('div');
  identity.className = 'world-feed-manager-activity-identity';
  const name = document.createElement('strong');
  name.textContent = row.manager_name || 'Manager';
  const club = document.createElement('small');
  club.textContent = row.club_name || row.club_id || '';
  identity.append(name, club);

  const counts = document.createElement('div');
  counts.className = 'world-feed-manager-activity-counts';
  counts.textContent = `${Number(row.posts) || 0} posts · ${Number(row.comments_made) || 0} comments · ${Number(row.comments_received_from_others) || 0} replies received`;

  const last = document.createElement('div');
  last.className = 'world-feed-manager-activity-last';
  last.textContent = inactivityText(row);
  node.append(identity, counts, last);
  return node;
}

function renderActivity(data) {
  const panel = ensureActivityPanel();
  if (!panel) return;
  panel.replaceChildren();

  const heading = document.createElement('div');
  heading.className = 'world-feed-activity-heading';
  const copy = document.createElement('div');
  const title = document.createElement('strong');
  title.textContent = `Your social activity · last ${Number(data?.window_days) || 30} days`;
  const note = document.createElement('small');
  note.textContent = 'Posts and comments only — not a measure of club management.';
  copy.append(title, note);
  const last = document.createElement('span');
  last.textContent = inactivityText(data?.current || {});
  heading.append(copy, last);
  panel.append(heading);

  const current = data?.current || {};
  const metrics = document.createElement('div');
  metrics.className = 'world-feed-activity-metrics';
  metrics.append(
    metric('posts', current.posts),
    metric('comments', current.comments_made),
    metric('replies from others', current.comments_received_from_others)
  );
  panel.append(metrics);

  const managers = Array.isArray(data?.managers) ? data.managers : [];
  if (data?.can_view_roster && managers.length) {
    const details = document.createElement('details');
    details.className = 'world-feed-manager-activity';
    const summary = document.createElement('summary');
    summary.textContent = `Manager social activity · ${managers.length} active managers`;
    details.append(summary);
    managers.forEach((row) => details.append(managerActivityRow(row)));
    panel.append(details);
  }
}

async function loadSocialActivity({ force = false } = {}) {
  if (!force && Date.now() - activityLoadedAt < ACTIVITY_TTL) return;
  if (activityLoading) return activityLoading;
  const panel = ensureActivityPanel();
  if (!panel) return;
  const token = feedToken();
  if (!token) return;

  activityLoading = (async () => {
    const response = await fetch('/api/world-feed', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'activity' })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Social activity is unavailable');
    renderActivity(data);
    activityLoadedAt = Date.now();
  })().catch((error) => {
    const current = ensureActivityPanel();
    const status = current?.querySelector('.world-feed-activity-heading > span');
    if (status) status.textContent = error.message;
  }).finally(() => { activityLoading = null; });
  return activityLoading;
}

const observer = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    mutation.addedNodes.forEach((node) => {
      if (!(node instanceof HTMLElement)) return;
      if (node.matches('.world-feed-comments')) enhanceCommentSection(node);
      enhanceComments(node);
      if (node.matches('.world-feed-shell') || node.querySelector('.world-feed-shell')) {
        void loadSocialActivity({ force: false });
      }
    });
  }
});
observer.observe(document.documentElement, { childList: true, subtree: true });

document.addEventListener('submit', (event) => {
  const form = event.target.closest?.('.world-feed-comment-form');
  if (!form) return;
  const itemId = String(form.closest('.world-feed-item')?.dataset.feedItemId || '');
  if (itemId) {
    expandAfterComment.add(itemId);
    setTimeout(() => expandAfterComment.delete(itemId), 30_000);
  }
  setTimeout(() => { void loadSocialActivity({ force: true }); }, 1500);
}, true);

document.addEventListener('submit', (event) => {
  if (!event.target.closest?.('.world-feed-composer')) return;
  setTimeout(() => { void loadSocialActivity({ force: true }); }, 1500);
}, true);

document.addEventListener('tbg:view-changed', (event) => {
  if (event.detail?.view !== 'feed') return;
  enhanceComments(document);
  void loadSocialActivity({ force: false });
});

window.addEventListener('tbg:portal-rendered', () => {
  enhanceComments(document);
  if (document.getElementById('feedView')?.classList.contains('active')) void loadSocialActivity({ force: false });
});
