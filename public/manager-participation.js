let participationDialog = null;
let participationCache = new Map();
const CACHE_TTL = 60_000;

function authToken() {
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

function dialog() {
  if (participationDialog) return participationDialog;
  const node = document.createElement('dialog');
  node.className = 'manager-participation-dialog';
  node.innerHTML = '<div class="manager-participation-card"><button class="manager-participation-close" type="button" aria-label="Close">×</button><div class="manager-participation-content"></div></div>';
  node.querySelector('.manager-participation-close').addEventListener('click', () => node.close());
  node.addEventListener('click', (event) => { if (event.target === node) node.close(); });
  document.body.append(node);
  participationDialog = node;
  return node;
}

function metric(label, value) {
  const node = document.createElement('span');
  node.className = 'manager-participation-metric';
  const strong = document.createElement('strong');
  strong.textContent = String(Number(value) || 0);
  const small = document.createElement('small');
  small.textContent = label;
  node.append(strong, small);
  return node;
}

function render(data) {
  const modal = dialog();
  const root = modal.querySelector('.manager-participation-content');
  root.replaceChildren();

  const head = document.createElement('header');
  head.className = 'manager-participation-head';
  const title = document.createElement('div');
  const kicker = document.createElement('small');
  kicker.textContent = data.is_self ? 'YOUR MANAGER PROFILE' : 'MANAGER PROFILE';
  const h2 = document.createElement('h2');
  h2.textContent = data.manager_name || 'Manager';
  const club = document.createElement('p');
  club.textContent = data.club_name || '';
  title.append(kicker, h2, club);
  const status = document.createElement('span');
  status.className = 'manager-participation-status';
  status.textContent = data.last_meaningful_period || 'No recent manager activity';
  head.append(title, status);
  root.append(head);

  const principle = document.createElement('p');
  principle.className = 'manager-participation-principle';
  principle.textContent = data.is_self
    ? 'A picture of meaningful things you have done in the world — not login time, clicks or an activity score.'
    : 'Recent meaningful participation, shown coarsely rather than as a last-seen tracker.';
  root.append(principle);

  const pins = Array.isArray(data.pins) ? data.pins : [];
  const pinSection = document.createElement('section');
  pinSection.className = 'manager-participation-section';
  const pinTitle = document.createElement('h3');
  pinTitle.textContent = 'Pins';
  pinSection.append(pinTitle);
  const pinGrid = document.createElement('div');
  pinGrid.className = 'manager-pin-grid';
  if (!pins.length) {
    const empty = document.createElement('p');
    empty.className = 'manager-participation-empty';
    empty.textContent = 'No pins yet — they appear naturally as you manage and participate.';
    pinGrid.append(empty);
  } else {
    pins.forEach((pin) => {
      const badge = document.createElement('article');
      badge.className = 'manager-pin';
      const icon = document.createElement('span');
      icon.textContent = pin.icon || '●';
      const copy = document.createElement('div');
      const name = document.createElement('strong');
      name.textContent = pin.name || 'Pin';
      const description = document.createElement('small');
      description.textContent = pin.description || '';
      copy.append(name, description);
      badge.append(icon, copy);
      pinGrid.append(badge);
    });
  }
  pinSection.append(pinGrid);
  root.append(pinSection);

  const recent = Array.isArray(data.recent_activity) ? data.recent_activity : [];
  const recentSection = document.createElement('section');
  recentSection.className = 'manager-participation-section';
  const recentTitle = document.createElement('h3');
  recentTitle.textContent = 'Recently';
  recentSection.append(recentTitle);
  const recentList = document.createElement('div');
  recentList.className = 'manager-recent-activity';
  if (!recent.length) {
    const empty = document.createElement('p');
    empty.className = 'manager-participation-empty';
    empty.textContent = 'No recent manager activity to show.';
    recentList.append(empty);
  } else {
    recent.forEach((row) => {
      const item = document.createElement('div');
      item.className = `manager-recent-item manager-recent-${row.kind || 'world'}`;
      const label = document.createElement('span');
      label.textContent = row.label || 'Manager activity';
      const period = document.createElement('small');
      period.textContent = row.period || 'Recently';
      item.append(label, period);
      recentList.append(item);
    });
  }
  recentSection.append(recentList);
  root.append(recentSection);

  if (data.is_self && data.private_detail) {
    const details = data.private_detail;
    const section = document.createElement('section');
    section.className = 'manager-participation-section';
    const h3 = document.createElement('h3');
    h3.textContent = 'Your participation snapshot';
    const note = document.createElement('p');
    note.className = 'manager-participation-note';
    note.textContent = 'For your eyes: raw counts that help you notice your own patterns. They are not combined into a score.';
    const metrics = document.createElement('div');
    metrics.className = 'manager-participation-metrics';
    metrics.append(
      metric('team sheets', details.team_submissions),
      metric('on time', details.on_time_team_submissions),
      metric('football actions', details.football_actions),
      metric('feed posts', details.world_feed_posts),
      metric('comments', details.world_feed_comments),
      metric('replies received', details.replies_received),
      metric('transfers', details.completed_transfers)
    );
    section.append(h3, note, metrics);
    root.append(section);
  }
}

async function openManagerParticipation(managerId = '') {
  const modal = dialog();
  const root = modal.querySelector('.manager-participation-content');
  root.innerHTML = '<p class="manager-participation-loading">Loading manager participation…</p>';
  if (!modal.open) modal.showModal();
  const token = authToken();
  if (!token) {
    root.textContent = 'Sign in to view manager participation.';
    return;
  }
  const key = managerId || 'self';
  const cached = participationCache.get(key);
  if (cached && Date.now() - cached.loadedAt < CACHE_TTL) {
    render(cached.data);
    return;
  }
  try {
    const query = managerId ? `?manager_id=${encodeURIComponent(managerId)}` : '';
    const response = await fetch(`/api/manager-participation${query}`, { headers: { authorization: `Bearer ${token}` } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Could not load manager participation');
    participationCache.set(key, { data, loadedAt: Date.now() });
    render(data);
  } catch (error) {
    root.textContent = error.message;
  }
}

document.addEventListener('click', (event) => {
  const own = event.target.closest?.('#managerChip');
  if (own) {
    event.preventDefault();
    void openManagerParticipation('');
    return;
  }
  const manager = event.target.closest?.('[data-manager-profile-id]');
  if (!manager) return;
  event.preventDefault();
  const managerId = String(manager.dataset.managerProfileId || '');
  if (managerId) void openManagerParticipation(managerId);
}, true);

window.addEventListener('tbg:world-feed-mutation-succeeded', () => participationCache.clear());
window.addEventListener('tbg:portal-rendered', () => participationCache.clear());

export { openManagerParticipation };
