import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Inbox polish adds filter tabs without mutating the observed message list', async () => {
  const [behaviour, css, directory] = await Promise.all([
    read('public/inbox-polish.js'),
    read('public/inbox-polish.css'),
    read('public/manager-directory.js')
  ]);

  assert.match(directory, /import '\.\/inbox-polish\.js'/);
  assert.match(behaviour, /\['all', 'All messages'\]/);
  assert.match(behaviour, /\['unread', 'Unread'\]/);
  assert.match(behaviour, /\['high', 'High priority'\]/);
  assert.match(behaviour, /\['normal', 'Normal'\]/);
  assert.match(behaviour, /observer\.observe\(list, \{ childList: true \}\)/);
  assert.match(behaviour, /card\.hidden = !show/);
  assert.match(behaviour, /card\.dataset\.inboxPriority/);
  assert.match(css, /#dashboardView \.inbox-filter-tabs/);
  assert.match(css, /grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(css, /#dashboardView #inboxList \.inbox-message\.unread/);
  assert.match(css, /data-inbox-priority="high"/);
});
