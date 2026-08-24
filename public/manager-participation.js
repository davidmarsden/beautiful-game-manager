import { communityCard } from './community-card.js';

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
  node.innerHTML = `<strong>${String(Number(value) || 0)}</strong><small>${label}</small>`;
  return node;
}

function sectionTitle(text) {
  const h3 = document.createElement('h3');
  h3.textContent = text;
  return h3;
}

function contactLink(label, value, kind) {
  const row = document.createElement('div');
  row.className = 'manager-contact-row';
  const strong = document.createElement('strong');
  strong.textContent = label;
  const link = document.createElement('a');
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  if (kind === 'email') {
    link.href = `mailto:${value}`;
  } else if (/^https?:\/\//i.test(value)) {
    link.href = value;
  } else {
    link.removeAttribute('target');
    link.removeAttribute('rel');
  }
  link.textContent = value;
  row.append(strong, link);
  return row;
}

function renderPublicContact(root, data) {
  const contact = data.contact || {};
  const entries = [
    ['WhatsApp', contact.whatsapp, 'whatsapp'],
    ['Email', contact.contact_email, 'email'],
    ['Discord', contact.discord, 'discord']
  ].filter(([, value]) => value);
  if (!entries.length) return;
  const section = document.createElement('section');
  section.className = 'manager-participation-section';
  section.append(sectionTitle('Contact'));
  const list = document.createElement('div');
  list.className = 'manager-contact-list';
  entries.forEach(([label, value, kind]) => list.append(contactLink(label, value, kind)));
  section.append(list);
  root.append(section);
}

function renderContactEditor(root, data) {
  const contact = data.contact || {};
  const section = document.createElement('section');
  section.className = 'manager-participation-section manager-contact-editor';
  section.append(sectionTitle('Contact details'));
  const note = document.createElement('p');
  note.className = 'manager-participation-note';
  note.textContent = 'Optional. Nothing is public unless you tick Share. Your sign-in email is never exposed automatically.';
  const form = document.createElement('form');
  form.className = 'manager-contact-form';
  form.innerHTML = `
    <label>WhatsApp<input name="whatsapp" maxlength="240" placeholder="Number or WhatsApp link"><span><input type="checkbox" name="publish_whatsapp"> Share with other managers</span></label>
    <label>Contact email<input name="contact_email" type="email" maxlength="240" placeholder="Optional public contact email"><span><input type="checkbox" name="publish_email"> Share with other managers</span></label>
    <label>Discord<input name="discord" maxlength="240" placeholder="Username or invite/profile link"><span><input type="checkbox" name="publish_discord"> Share with other managers</span></label>
    <div class="manager-contact-actions"><button type="submit">Save contact details</button><span class="manager-contact-status" aria-live="polite"></span></div>`;
  form.elements.whatsapp.value = contact.whatsapp || '';
  form.elements.contact_email.value = contact.contact_email || '';
  form.elements.discord.value = contact.discord || '';
  form.elements.publish_whatsapp.checked = Boolean(contact.publish_whatsapp);
  form.elements.publish_email.checked = Boolean(contact.publish_email);
  form.elements.publish_discord.checked = Boolean(contact.publish_discord);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const status = form.querySelector('.manager-contact-status');
    const button = form.querySelector('button');
    button.disabled = true;
    status.textContent = 'Saving…';
    try {
      const response = await fetch('/api/manager-participation', {
        method: 'POST',
        headers: { authorization: `Bearer ${authToken()}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'save-contact',
          whatsapp: form.elements.whatsapp.value,
          contact_email: form.elements.contact_email.value,
          discord: form.elements.discord.value,
          publish_whatsapp: form.elements.publish_whatsapp.checked,
          publish_email: form.elements.publish_email.checked,
          publish_discord: form.elements.publish_discord.checked
        })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Could not save contact details');
      participationCache.clear();
      status.textContent = 'Saved';
    } catch (error) {
      status.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
  section.append(note, form);
  root.append(section);
}

function render(data) {
  const modal = dialog();
  const root = modal.querySelector('.manager-participation-content');
  root.replaceChildren();

  const head = document.createElement('header');
  head.className = 'manager-participation-head';
  const title = document.createElement('div');
  title.innerHTML = `<small>${data.is_self ? 'YOUR MANAGER PROFILE' : 'MANAGER PROFILE'}</small><h2></h2><p></p>`;
  title.querySelector('h2').textContent = data.manager_name || 'Manager';
  title.querySelector('p').textContent = data.club_name || '';
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

  if (data.is_self) root.append(communityCard());
  if (data.is_self) renderContactEditor(root, data);
  else renderPublicContact(root, data);

  const pins = Array.isArray(data.pins) ? data.pins : [];
  const pinSection = document.createElement('section');
  pinSection.className = 'manager-participation-section';
  pinSection.append(sectionTitle('Pins'));
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
      badge.innerHTML = `<span></span><div><strong></strong><small></small></div>`;
      badge.querySelector('span').textContent = pin.icon || '●';
      badge.querySelector('strong').textContent = pin.name || 'Pin';
      badge.querySelector('small').textContent = pin.description || '';
      pinGrid.append(badge);
    });
  }
  pinSection.append(pinGrid);
  root.append(pinSection);

  const recent = Array.isArray(data.recent_activity) ? data.recent_activity : [];
  const recentSection = document.createElement('section');
  recentSection.className = 'manager-participation-section';
  recentSection.append(sectionTitle('Recently'));
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
      item.innerHTML = '<span></span><small></small>';
      item.querySelector('span').textContent = row.label || 'Manager activity';
      item.querySelector('small').textContent = row.period || 'Recently';
      recentList.append(item);
    });
  }
  recentSection.append(recentList);
  root.append(recentSection);

  if (data.is_self && data.private_detail) {
    const details = data.private_detail;
    const section = document.createElement('section');
    section.className = 'manager-participation-section';
    const note = document.createElement('p');
    note.className = 'manager-participation-note';
    note.textContent = 'For your eyes: raw counts that help you notice your own patterns. They are not combined into a score.';
    const metrics = document.createElement('div');
    metrics.className = 'manager-participation-metrics';
    metrics.append(
      metric('team sheets', details.team_submissions), metric('on time', details.on_time_team_submissions),
      metric('football actions', details.football_actions), metric('feed posts', details.world_feed_posts),
      metric('comments', details.world_feed_comments), metric('replies received', details.replies_received),
      metric('transfers', details.completed_transfers)
    );
    section.append(sectionTitle('Your participation snapshot'), note, metrics);
    root.append(section);
  }

  const directory = Array.isArray(data.directory) ? data.directory : [];
  if (data.is_self && directory.length) {
    const section = document.createElement('section');
    section.className = 'manager-participation-section';
    const note = document.createElement('p');
    note.className = 'manager-participation-note';
    note.textContent = 'Open any manager to see their public pins, recent participation and any contact details they chose to share.';
    const list = document.createElement('div');
    list.className = 'manager-participation-directory';
    directory.forEach((manager) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'manager-directory-row';
      button.dataset.managerProfileId = manager.manager_id || '';
      button.innerHTML = '<strong></strong><small></small>';
      button.querySelector('strong').textContent = manager.manager_name || 'Manager';
      button.querySelector('small').textContent = manager.club_id || '';
      list.append(button);
    });
    section.append(sectionTitle('Managers in this world'), note, list);
    root.append(section);
  }
}

async function openManagerParticipation(managerId = '') {
  const modal = dialog();
  const root = modal.querySelector('.manager-participation-content');
  root.innerHTML = '<p class="manager-participation-loading">Loading manager participation…</p>';
  if (!modal.open) modal.showModal();
  const token = authToken();
  if (!token) { root.textContent = 'Sign in to view manager participation.'; return; }
  const key = managerId || 'self';
  const cached = participationCache.get(key);
  if (cached && Date.now() - cached.loadedAt < CACHE_TTL) { render(cached.data); return; }
  try {
    const query = managerId ? `?manager_id=${encodeURIComponent(managerId)}` : '';
    const response = await fetch(`/api/manager-participation${query}`, { headers: { authorization: `Bearer ${token}` } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Could not load manager participation');
    participationCache.set(key, { data, loadedAt: Date.now() });
    render(data);
  } catch (error) { root.textContent = error.message; }
}

document.addEventListener('click', (event) => {
  const own = event.target.closest?.('#managerChip');
  if (own) { event.preventDefault(); void openManagerParticipation(''); return; }
  const manager = event.target.closest?.('[data-manager-profile-id]');
  if (!manager) return;
  event.preventDefault();
  const managerId = String(manager.dataset.managerProfileId || '');
  if (managerId) void openManagerParticipation(managerId);
}, true);

window.addEventListener('tbg:world-feed-mutation-succeeded', () => participationCache.clear());
window.addEventListener('tbg:portal-rendered', () => participationCache.clear());

export { openManagerParticipation };
