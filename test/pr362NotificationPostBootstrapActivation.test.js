import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const client = fs.readFileSync(new URL('../public/manager-notifications.js', import.meta.url), 'utf8');

test('manager notifications do not make authenticated requests during portal bootstrap', () => {
  assert.ok(client.includes("window.addEventListener('tbg:portal-rendered', activateNotifications)"));
  assert.ok(client.includes("window.addEventListener('tbg:portal-refreshed', activateNotifications)"));
  assert.ok(client.includes("document.documentElement.dataset.portalReady === 'true'"));
  assert.ok(client.includes('function activateNotifications()'));
  assert.ok(client.includes('notificationsActive = true'));
  assert.ok(client.includes('void refresh();'));
  assert.ok(client.includes('window.setInterval(() => void refresh(), 60_000)'));
  assert.equal(client.trimEnd().endsWith('install();'), false);
  assert.equal(client.includes("document.addEventListener('DOMContentLoaded', install)"), false);
});
