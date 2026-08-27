import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const client = fs.readFileSync(new URL('../public/manager-notifications.js', import.meta.url), 'utf8');

test('background notification fetch failures stay inside notification UI', () => {
  assert.ok(client.includes("console.warn('Manager notification refresh failed'"));
  assert.ok(client.includes("console.warn('Manager notification mutation failed'"));
  assert.ok(client.includes('async function refresh(forceRender = false, showError = false)'));
  assert.ok(client.includes('catch (error)'));
  assert.ok(client.includes('if (showError) renderRefreshError();'));
  assert.ok(client.includes('void refresh();'));
  assert.ok(client.includes('window.setInterval(() => void refresh(), 60_000)'));
});

test('interactive inbox refresh can show a local retry message', () => {
  assert.ok(client.includes('Notifications could not be refreshed just now. The rest of the portal is unaffected; please try again.'));
  assert.ok(client.includes('await refresh(true, true);'));
});

test('successful polling clears a stale local refresh error', () => {
  assert.ok(client.includes("root.dataset.notificationRefreshError = 'true';"));
  assert.ok(client.includes("root?.dataset.notificationRefreshError === 'true'"));
  assert.ok(client.includes('if (forceRender || recoveredFromError)'));
  assert.ok(client.includes('delete root.dataset.notificationRefreshError;'));
});
