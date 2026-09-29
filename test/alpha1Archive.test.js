import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Alpha 1 archive state is exposed and manager mutation controls are disabled', async () => {
  const [bootstrap, html, archive, app] = await Promise.all([
    read('netlify/functions/bootstrap.mjs'),
    read('public/index.html'),
    read('public/alpha-archive.js'),
    read('public/app.js')
  ]);
  assert.match(bootstrap, /select=id,status,archive_mode,archived_at,archive_reason/);
  assert.match(bootstrap, /read_only: Boolean\(archive\.archive_mode\)/);
  assert.match(html, /id="archiveBanner"/);
  assert.match(html, /alpha-archive\.js/);
  assert.match(archive, /#decisionForm button\[type="submit"\]/);
  assert.match(archive, /control\.disabled = true/);
  assert.match(archive, /blockArchivedSubmit/);
  assert.match(app, /!fixture \|\| Boolean\(data\.archive\?\.read_only\)/);
  assert.match(app, /tbg:portal-rendered/);
});
