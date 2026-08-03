import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const scheduled = fs.readFileSync(new URL('../netlify/functions/scheduled-world-turn.mjs', import.meta.url), 'utf8');
const background = fs.readFileSync(new URL('../netlify/functions/scheduled-world-turn-background.mjs', import.meta.url), 'utf8');

test('internal scheduler authentication reuses only the server-side service role secret', () => {
  assert.match(scheduled, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(background, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(scheduled, /TBG_INTERNAL_SCHEDULER_SECRET/);
  assert.doesNotMatch(background, /TBG_INTERNAL_SCHEDULER_SECRET/);
});
