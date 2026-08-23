import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(new URL('../supabase/migrations/20260823d_transfer_history_revision_correlation.sql', import.meta.url), 'utf8');

test('#289 transfer history scopes authoritative legs to the terminal deal revision', () => {
  assert.match(migration, /from\s+terminal_deals\s+td/i);
  assert.match(migration, /where\s+leg\.revision_id\s*=\s*td\.revision_id/i);
  assert.doesNotMatch(migration, /where\s+leg\.revision_id\s*=\s*revision_id\b/i);
});
