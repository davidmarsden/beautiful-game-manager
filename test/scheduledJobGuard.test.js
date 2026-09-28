import test from 'node:test';
import assert from 'node:assert/strict';

async function freshGuard() {
  delete globalThis.__tbgScheduledJobGuard;
  return import(`../netlify/functions/_lib/scheduled-job-guard.mjs?test=${Date.now()}-${Math.random()}`);
}

test('timed-out scheduled work remains registered until its handler settles', async () => {
  const { runScheduledJob, schedulerGuardSnapshot } = await freshGuard();
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  const first = await runScheduledJob('slow-job', () => blocked, { timeoutMs: 5, healthcheck: false });
  assert.equal(first.status, 503);
  assert.deepEqual(schedulerGuardSnapshot().running, ['slow-job']);

  const overlap = await runScheduledJob('slow-job', async () => new Response('wrong'), { healthcheck: false });
  assert.equal((await overlap.json()).skipped, 'already_running');

  release(new Response('ok'));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(schedulerGuardSnapshot().running, []);
});

test('resolved 5xx responses count toward the database circuit breaker', async () => {
  const { runScheduledJob, schedulerGuardSnapshot } = await freshGuard();
  const failure = () => Promise.resolve(new Response('db unavailable', { status: 503 }));

  assert.equal((await runScheduledJob('failure-1', failure, { healthcheck: false })).status, 503);
  assert.equal(schedulerGuardSnapshot().consecutive_database_failures, 1);

  assert.equal((await runScheduledJob('failure-2', failure, { healthcheck: false })).status, 503);
  const snapshot = schedulerGuardSnapshot();
  assert.equal(snapshot.consecutive_database_failures, 2);
  assert.ok(snapshot.circuit_open_until);

  const skipped = await runScheduledJob('another-job', async () => new Response('should not run'), { healthcheck: false });
  assert.equal((await skipped.json()).skipped, 'database_circuit_open');
});
