import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

for (const path of ['netlify/functions/club-claim.mjs', 'netlify/functions/alpha-admin.mjs']) {
  test(`#291 ${path} defaults to the authoritative running world id`, () => {
    const source = read(path);
    assert.match(source, /process\.env\.TBG_WORLD_ID \|\| 'tbg-world-1'/);
    assert.doesNotMatch(source, /process\.env\.TBG_WORLD_ID \|\| 'tbg-world-001'/);
  });
}

test('#291 reconciliation migration normalizes the club catalogue and alpha state', () => {
  const migration = read('supabase/migrations/20260824f_normalize_canonical_world_id.sql');
  assert.match(migration, /UPDATE public\.clubs[\s\S]*SET world_id = 'tbg-world-1'[\s\S]*WHERE world_id = 'tbg-world-001'/);
  assert.match(migration, /UPDATE public\.manager_appointments[\s\S]*SET world_id = 'tbg-world-1'[\s\S]*WHERE world_id = 'tbg-world-001'/);
  assert.match(migration, /UPDATE public\.alpha_appointment_events[\s\S]*SET world_id = 'tbg-world-1'/);
  assert.match(migration, /canonical\.world_id = 'tbg-world-1'/);
  assert.match(migration, /legacy\.world_id = 'tbg-world-001'/);
  assert.match(migration, /active canonical collision exists/);
});
