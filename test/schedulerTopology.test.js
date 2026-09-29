import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

async function filesUnder(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  }));
  return nested.flat();
}

test('Netlify schedules have one owner and recovery pause inventories every job', async () => {
  const files = (await filesUnder('netlify')).filter((path) => /\.(mjs|js)$/.test(path));
  const offenders = [];
  for (const path of files) {
    const source = await readFile(path, 'utf8');
    if (/export\s+const\s+config\s*=\s*\{[\s\S]*?schedule\s*:/m.test(source)) offenders.push(path);
  }
  assert.deepEqual(offenders, [], 'function-level schedules bypass the central scheduler registry');

  const config = await readFile('netlify.toml', 'utf8');
  assert.match(config, /CENTRAL SCHEDULER REGISTRY/);
  for (const name of [
    'lock-fixtures',
    'run-fixtures',
    'scheduled-world-turn',
    'player-release-settlement',
    'refresh-match-archives',
    'settle-transfers',
    'manager-notification-email-scheduled',
    'manager-inactivity-checkin-scheduled',
    'manager-inactivity-enforcement-scheduled',
    'world-maintenance'
  ]) assert.ok(config.includes(name), `central scheduler registry must inventory ${name}`);

  assert.ok(config.includes('refresh-world-read-model              RETIRED'));
});

test('retired standalone read-model cron is absent', async () => {
  const files = await filesUnder('netlify/functions');
  assert.ok(!files.some((path) => path.endsWith('refresh-world-read-model.mjs')));
});

test('scheduled entry points use the shared workload guard', async () => {
  for (const path of [
    'netlify/functions/lock-fixtures.mjs',
    'netlify/functions/run-fixtures.mjs',
    'netlify/functions/player-release-settlement.mjs',
    'netlify/functions/world-maintenance.mjs',
    'netlify/functions/refresh-match-archives.mjs',
    'netlify/functions/settle-transfers.mjs',
    'netlify/functions/manager-notification-email-scheduled.mjs',
    'netlify/functions/manager-inactivity-checkin-scheduled.mjs',
    'netlify/functions/manager-inactivity-enforcement-scheduled.mjs',
    'netlify/internal/scheduled-world-turn-worker.mjs'
  ]) {
    const source = await readFile(path, 'utf8');
    assert.match(source, /runScheduledJob\(/, `${path} must use runScheduledJob`);
  }
});
