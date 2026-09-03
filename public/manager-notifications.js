let notificationDialog = null;
let notificationData = null;
let pollTimer = null;
let notificationsActive = false;
let unassignedObserver = null;

async function authorization() {
  if (!window.tbgPortalAuth?.waitForAuthorization) throw new Error('Portal authentication bridge is unavailable');
  return window.tbgPortalAuth.waitForAuthorization();
}

function ensureBell() {
  let button = document.getElementById('managerNotificationsButton');
  if (button) return button;
  const managerChip = document.getElementById('managerChip');
  if (!managerChip?.parentElement) return null;
  button = document.createElement('button');
  button.id = 'managerNotificationsButton';
  button.className = 'manager-notifications-button';
  button.type = 'button';
  button.setAttribute('aria-label', 'Notifications');
  button.innerHTML = '<span aria-hidden="true">🔔</span><strong hidden>0</strong>';
  managerChip.before(button);
  return button;
}

function ensureDialog() {
  if (notificationDialog) return notificationDialog;
  const dialog = document.createElement('dialog');
  dialog.className = 'manager-notifications-dialog';
  dialog.innerHTML = `
    <div class="manager-notifications-card">
      <header><div><small>MANAGER INBOX</small><h2>Notifications</h2></div><button type="button" class="manager-notifications-close" aria-label="Close">×</button></header>
      <div class="manager-notifications-tabs"><button type="button" data-tab="notifications" class="active">Notifications</button><button type="button" data-tab="reports">My reports</button><button type="button" data-tab="settings">Settings</button></div>
      <div class="manager-notifications-content"></div>
    </div>`;
  dialog.querySelector('.manager-notifications-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
  dialog.querySelectorAll('[data-tab]').forEach((button) => button.addEventListener('click', () => {
    dialog.querySelectorAll('[data-tab]').forEach((node) => node.classList.toggle('active', node === button));
    render(button.dataset.tab);
  }));
  document.body.append(dialog);
  notificationDialog = dialog;
  return dialog;
}

function relativeTime(value) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return '';
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return new Date(value).toLocaleDateString();
}

function statusLabel(report) {
  if (report.status === 'new') return 'Received';
  if (report.status === 'triaged') return 'Confirmed';
  if (report.status === 'fixed') return 'Fixed';
  if (report.status === 'wont_fix') return 'Closed';
  return report.status || 'Received';
}

function renderNotifications(root) {
  const notifications = notificationData?.notifications || [];
  const controls = document.createElement('div');
  controls.className = 'manager-notifications-controls';
  controls.innerHTML = `<span>${Number(notificationData?.unread_count || 0)} unread</span><button type="button">Mark all read</button>`;
  controls.querySelector('button').disabled = !Number(notificationData?.unread_count || 0);
  controls.querySelector('button').addEventListener('click', async () => {
    const marked = await mutate({ action: 'mark-all-read' });
    if (marked) await refresh(true, true);
  });
  root.append(controls);
  if (!notifications.length) {
    root.insertAdjacentHTML('beforeend', '<p class="manager-notifications-empty">Nothing here yet.</p>');
    return;
  }
  const list = document.createElement('div');
  list.className = 'manager-notifications-list';
  for (const item of notifications) {
    const row = document.createElement(item.action_url ? 'a' : 'button');
    row.className = `manager-notification manager-notification-${item.notification_class || 'info'}${item.read_at ? '' : ' unread'}`;
    if (item.action_url) { row.href = item.action_url; row.target = /^https?:/i.test(item.action_url) ? '_blank' : '_self'; row.rel = 'noopener noreferrer'; }
    else row.type = 'button';
    row.innerHTML = '<span class="manager-notification-icon"></span><div><strong></strong><p></p><small></small></div>';
    row.querySelector('.manager-notification-icon').textContent = item.notification_class === 'action_required' ? '⚡' : item.notification_class === 'reward' ? '🏅' : '●';
    row.querySelector('strong').textContent = item.title || 'Notification';
    row.querySelector('p').textContent = item.body || '';
    row.querySelector('small').textContent = relativeTime(item.created_at);
    row.addEventListener('click', async () => {
      if (item.read_at) return;
      if (item.action_url) {
        void mutate({ action: 'mark-read', notification_id: item.id });
        return;
      }
      const marked = await mutate({ action: 'mark-read', notification_id: item.id });
      if (marked) await refresh(true, true);
    });
    list.append(row);
  }
  root.append(list);
}

function renderReports(root) {
  const hunter = notificationData?.bug_hunter || {};
  const summary = document.createElement('div');
  summary.className = 'bug-hunter-summary';
  summary.innerHTML = `<span>🐞</span><div><strong>Bug Hunter</strong><p><b>${Number(hunter.confirmed_reports || 0)}</b> confirmed reports · <b>${Number(hunter.points || 0)}</b> impact points</p></div>`;
  root.append(summary);
  const reports = notificationData?.reports || [];
  if (!reports.length) { root.insertAdjacentHTML('beforeend', '<p class="manager-notifications-empty">You have not submitted any alpha reports yet.</p>'); return; }
  const list = document.createElement('div');
  list.className = 'manager-report-list';
  for (const report of reports) {
    const row = document.createElement('article');
    row.className = 'manager-report-row';
    const events = Array.isArray(report.events) ? report.events : [];
    row.innerHTML = `<header><div><strong></strong><small></small></div><span></span></header><div class="manager-report-timeline"></div>`;
    row.querySelector('strong').textContent = report.page_area || (report.kind === 'bug' ? 'Bug report' : 'Feedback');
    row.querySelector('small').textContent = `${report.category || 'other'} · ${relativeTime(report.created_at)}`;
    const badge = row.querySelector('header > span');
    badge.textContent = statusLabel(report);
    badge.dataset.status = report.status || 'new';
    const timeline = row.querySelector('.manager-report-timeline');
    for (const event of events) {
      const item = document.createElement('div');
      item.innerHTML = '<span></span><p></p><small></small>';
      item.querySelector('span').textContent = '●';
      item.querySelector('p').textContent = String(event.event_type || '').replace(/^status_/, '').replaceAll('_', ' ');
      item.querySelector('small').textContent = relativeTime(event.created_at);
      timeline.append(item);
    }
    if (report.github_issue_url) {
      const link = document.createElement('a');
      link.href = report.github_issue_url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = 'Open engineering issue ↗';
      row.append(link);
    }
    list.append(row);
  }
  root.append(list);
}

function renderSettings(root) {
  const preferences = notificationData?.delivery_preferences || {};
  const form = document.createElement('form');
  form.className = 'manager-notification-settings';
  form.innerHTML = `
    <h3>Email notifications</h3>
    <p>In-app notifications always stay on. Email is optional and only applies to new activity after you save these settings.</p>
    <label>Delivery
      <select name="email_frequency">
        <option value="off">Off</option>
        <option value="instant">As activity happens</option>
        <option value="daily">Daily digest</option>
      </select>
    </label>
    <fieldset>
      <legend>Email me about</legend>
      <label><input type="checkbox" name="email_transfers"> Transfers — offers, counter-offers and outcomes</label>
      <label><input type="checkbox" name="email_social"> News — comments and direct replies</label>
      <label><input type="checkbox" name="email_system"> Game & system — rewards, reports and future game alerts</label>
    </fieldset>
    <p class="manager-notification-settings-note">Daily digests are currently sent after 08:00 UTC. Browser push will use these same categories in a later update.</p>
    <button type="submit">Save notification settings</button>
    <p class="manager-notification-settings-status" aria-live="polite"></p>`;
  const frequency = form.elements.email_frequency;
  frequency.value = ['instant', 'daily'].includes(preferences.email_frequency) ? preferences.email_frequency : 'off';
  form.elements.email_transfers.checked = preferences.email_transfers !== false;
  form.elements.email_social.checked = preferences.email_social !== false;
  form.elements.email_system.checked = preferences.email_system === true;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const status = form.querySelector('.manager-notification-settings-status');
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    status.textContent = 'Saving…';
    const saved = await mutate({
      action: 'update-delivery-preferences',
      email_frequency: frequency.value,
      email_transfers: form.elements.email_transfers.checked,
      email_social: form.elements.email_social.checked,
      email_system: form.elements.email_system.checked
    });
    if (!saved) {
      status.textContent = 'Could not save settings just now. Please try again.';
      submit.disabled = false;
      return;
    }
    await refresh(false, false);
    status.textContent = frequency.value === 'off' ? 'Email notifications are off.' : 'Email notification settings saved.';
    submit.disabled = false;
  });
  root.append(form);
}

function render(tab = 'notifications') {
  const root = ensureDialog().querySelector('.manager-notifications-content');
  root.replaceChildren();
  delete root.dataset.notificationRefreshError;
  if (!notificationData) { root.innerHTML = '<p class="manager-notifications-empty">Loading notifications…</p>'; return; }
  if (tab === 'reports') renderReports(root);
  else if (tab === 'settings') renderSettings(root);
  else renderNotifications(root);
}

function renderRefreshError() {
  if (!notificationDialog?.open) return;
  const root = notificationDialog.querySelector('.manager-notifications-content');
  if (!root) return;
  root.dataset.notificationRefreshError = 'true';
  root.innerHTML = '<p class="manager-notifications-empty">Notifications could not be refreshed just now. The rest of the portal is unaffected; please try again.</p>';
}

async function mutate(body) {
  try {
    const bearer = await authorization();
    const response = await fetch('/api/manager-notifications', {
      method: 'POST',
      headers: { authorization: bearer, 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    return response.ok;
  } catch (error) {
    console.warn('Manager notification mutation failed', error);
    return false;
  }
}

async function refresh(forceRender = false, showError = false) {
  try {
    const bearer = await authorization();
    const response = await fetch('/api/manager-notifications', { headers: { authorization: bearer }, cache: 'no-store' });
    if (!response.ok) {
      if (showError) renderRefreshError();
      return false;
    }
    notificationData = await response.json();
    const bell = ensureBell();
    const count = Number(notificationData.unread_count || 0);
    const badge = bell?.querySelector('strong');
    if (badge) { badge.textContent = String(count); badge.hidden = count === 0; }
    if (notificationDialog?.open) {
      const root = notificationDialog.querySelector('.manager-notifications-content');
      const recoveredFromError = root?.dataset.notificationRefreshError === 'true';
      if (forceRender || recoveredFromError) {
        const tab = notificationDialog.querySelector('[data-tab].active')?.dataset.tab || 'notifications';
        render(tab);
      }
    }
    return true;
  } catch (error) {
    console.warn('Manager notification refresh failed', error);
    if (showError) renderRefreshError();
    return false;
  }
}

function install() {
  const bell = ensureBell();
  if (bell && !bell.dataset.notificationsBound) {
    bell.dataset.notificationsBound = 'true';
    bell.addEventListener('click', async () => {
      const dialog = ensureDialog();
      render('notifications');
      if (!dialog.open) dialog.showModal();
      await refresh(true, true);
    });
  }
}

function activateNotifications() {
  install();
  if (notificationsActive) return;
  notificationsActive = true;
  unassignedObserver?.disconnect();
  unassignedObserver = null;
  void refresh();
  if (!pollTimer) pollTimer = window.setInterval(() => void refresh(), 60_000);
}

function observeUnassignedPortal() {
  const unassigned = document.getElementById('unassignedState');
  if (!unassigned) return;
  const activateIfRendered = () => {
    if (!unassigned.hidden) activateNotifications();
  };
  activateIfRendered();
  if (notificationsActive) return;
  unassignedObserver = new MutationObserver(activateIfRendered);
  unassignedObserver.observe(unassigned, { attributes: true, attributeFilter: ['hidden'] });
}

window.addEventListener('tbg:portal-rendered', activateNotifications);
window.addEventListener('tbg:portal-refreshed', activateNotifications);
window.addEventListener('tbg:alpha-feedback-submitted', () => { if (notificationsActive) void refresh(true); });

observeUnassignedPortal();
if (document.documentElement.dataset.portalReady === 'true') activateNotifications();
