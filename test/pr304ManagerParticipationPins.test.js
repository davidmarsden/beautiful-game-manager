import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(new URL('../supabase/migrations/20260824b_manager_participation_pins.sql', import.meta.url), 'utf8');
const endpoint = fs.readFileSync(new URL('../netlify/functions/manager-participation.mjs', import.meta.url), 'utf8');
const client = fs.readFileSync(new URL('../public/manager-participation.js', import.meta.url), 'utf8');
const navigation = fs.readFileSync(new URL('../public/portal-navigation.js', import.meta.url), 'utf8');

test('participation is derived from meaningful authoritative actions rather than presence telemetry', () => {
  assert.ok(migration.includes('manager_turn_submissions'));
  assert.ok(migration.includes('manager_world_commands'));
  assert.ok(migration.includes('world_feed_items'));
  assert.ok(migration.includes('world_feed_comments'));
  assert.ok(migration.includes('transfer_deals'));
  assert.ok(migration.includes('Meaningful participation, not presence monitoring.'));
  assert.equal(migration.includes('login_events'), false);
  assert.equal(migration.includes('page_view'), false);
  assert.equal(migration.includes('minutes_active'), false);
  assert.equal(migration.includes('activity_score'), false);
});

test('pins reward recognizable football and social milestones without a composite score', () => {
  for (const key of ['ready_to_play', 'reliable', 'ever_present', 'from_dugout', 'in_conversation', 'conversation_starter', 'transfer_business', 'deal_maker']) {
    assert.ok(migration.includes(`'key','${key}'`));
  }
  assert.ok(client.includes('They are not combined into a score.'));
});

test('other-manager activity is deliberately coarse while private counts are self-only', () => {
  assert.ok(migration.includes("then 'Today'"));
  assert.ok(migration.includes("then 'This week'"));
  assert.ok(migration.includes("then 'Recently'"));
  assert.ok(migration.includes("case when is_self then jsonb_build_object("));
  assert.ok(migration.includes("else null end"));
  assert.ok(client.includes('shown coarsely rather than as a last-seen tracker'));
});

test('the manager chip opens the participation profile and self view includes an other-manager directory', () => {
  assert.ok(navigation.includes("import './manager-participation.js';"));
  assert.ok(navigation.includes("installStylesheet('./manager-participation.css')"));
  assert.ok(client.includes("event.target.closest?.('#managerChip')"));
  assert.ok(endpoint.includes('managerDirectory(context.worldId, context.managerId)'));
  assert.ok(client.includes("sectionTitle('Managers in this world')"));
  assert.ok(client.includes('data.managerProfileId'));
});

test('participation endpoint authenticates and scopes targets to the caller world', () => {
  assert.ok(endpoint.includes("identity(token)"));
  assert.ok(endpoint.includes('activeContext(user.id)'));
  assert.ok(endpoint.includes("p_world_id: context.worldId"));
  assert.ok(endpoint.includes("p_target_manager_id: target"));
  assert.ok(migration.includes("appointment.world_id = p_world_id"));
  assert.ok(migration.includes("raise exception 'Manager is not active in this world'"));
});
