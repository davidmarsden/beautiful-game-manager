import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(
  new URL('../supabase/migrations/20260828_supabase_hardening_search_path_inbox_index.sql', import.meta.url),
  'utf8'
);

test('feedback points function has an immutable safe search path', () => {
  assert.match(
    migration,
    /alter function public\.alpha_feedback_points\(text\)\s+set search_path = pg_catalog;/i
  );
});

test('manager inbox has an index matching recipient newest-first reads', () => {
  assert.match(
    migration,
    /create index if not exists manager_messages_recipient_created_idx\s+on public\.manager_messages \(recipient_manager_id, created_at desc\);/i
  );
});
