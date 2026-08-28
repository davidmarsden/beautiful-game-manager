import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(
  new URL('../supabase/migrations/20260828c_selective_hot_fk_indexes.sql', import.meta.url),
  'utf8',
);

test('indexes the selected hot foreign-key relationships', () => {
  const expected = [
    'manager_appointments_manager_idx',
    'manager_appointments_club_idx',
    'clubs_world_idx',
    'fixtures_world_idx',
    'fixtures_home_club_idx',
    'fixtures_away_club_idx',
    'manager_submissions_manager_idx',
    'manager_submissions_club_idx',
    'world_feed_comments_manager_idx',
    'world_feed_items_actor_manager_idx',
    'manager_notifications_world_idx',
  ];

  for (const indexName of expected) {
    assert.match(migration, new RegExp(`create index if not exists ${indexName}\\b`));
  }
});

test('does not turn the Supabase FK advisory into a blanket indexing policy', () => {
  assert.doesNotMatch(migration, /alpha_appointment_events_.*_idx/);
  assert.doesNotMatch(migration, /alpha_tester_invites_.*_idx/);
  assert.doesNotMatch(migration, /persistent_world_backups_.*_idx/);
  assert.doesNotMatch(migration, /transfer_deal_revisions_created_by_manager_idx/);
  assert.doesNotMatch(migration, /transfer_deal_change_requests_requested_by_manager_idx/);
});
