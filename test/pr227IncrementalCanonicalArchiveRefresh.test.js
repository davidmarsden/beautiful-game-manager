import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationUrl = new URL('../supabase/migrations/20260815_incremental_canonical_match_archive_refresh.sql', import.meta.url);

test('canonical match archive refresh is bounded to the just-completed matchday and remains restore-safe', async () => {
  const sql = await readFile(migrationUrl, 'utf8');

  assert.match(sql, /v_completed_matchday := case[\s\S]*new\.matchday - 1/i);
  assert.match(sql, /if v_result_matchday is distinct from v_completed_matchday then\s*continue;/i);
  assert.match(sql, /v_fixture := v_result->'fixture'/);
  assert.match(sql, /if v_fixture is null or jsonb_typeof\(v_fixture\) <> 'object' then/);
  assert.match(sql, /on conflict \(fixture_id\) do update/i);
  assert.match(sql, /archive_payload = excluded\.archive_payload/i);
  assert.match(sql, /source_checksum = excluded\.source_checksum/i);
  assert.doesNotMatch(sql, /if exists\s*\([\s\S]*canonical_match_archives[\s\S]*fixture_id = v_fixture_id[\s\S]*\) then\s*continue;/i);
  assert.doesNotMatch(sql, /on conflict \(fixture_id\) do nothing/i);
});
