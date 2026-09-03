import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(
  new URL('../supabase/migrations/20260903_zero_consideration_transfer_guard.sql', import.meta.url),
  'utf8'
);

test('zero-consideration transfer offers are rejected before approval', () => {
  assert.match(migration, /assert_transfer_revision_has_reciprocal_consideration/);
  assert.match(migration, /leg\.from_club_id = buyer_club_id_value/);
  assert.match(migration, /leg\.to_club_id = seller_club_id_value/);
  assert.match(migration, /leg\.leg_type = 'cash' and coalesce\(leg\.amount, 0\) > 0/);
  assert.match(migration, /leg\.leg_type = 'permanent_transfer'/);
  assert.match(migration, /Transfer offer must include cash or a player moving from the buying club to the selling club/);
  assert.match(migration, /before insert or update of decision on public\.transfer_deal_approvals/);
});

test('malformed offers cannot be promoted into binding settlement states', () => {
  assert.match(migration, /new\.status not in \('agreed','grace_period','binding','settling'\)/);
  assert.match(migration, /before update of status on public\.transfer_deals/);
});

test('pre-existing negotiating zero-consideration offers are retired', () => {
  assert.match(migration, /terminal_reason = 'invalid_zero_consideration_offer'/);
  assert.match(migration, /set status = 'withdrawn'/);
});
