import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(new URL('../supabase/migrations/20260908_qualitative_free_agent_rejection_feedback.sql', import.meta.url), 'utf8');

test('below-expectation free-agent rejections give qualitative feedback only', () => {
  assert.match(migration, /terms_below_expectation/);
  assert.match(migration, /felt your contract terms fell short of expectations\./);
  assert.doesNotMatch(migration, /expected_wage\s*=\s*/i);
  assert.doesNotMatch(migration, /minimum_score/i);
  assert.doesNotMatch(migration, /offer_score/i);
});

test('competing-club and generic rejection messages stay distinct', () => {
  assert.match(migration, /chose another club\./);
  assert.match(migration, /did not accept your contract offer\./);
});
