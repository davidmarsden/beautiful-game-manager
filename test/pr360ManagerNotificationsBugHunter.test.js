import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(new URL('../supabase/migrations/20260827b_manager_notifications_bug_hunter.sql', import.meta.url), 'utf8');
const auditRepeatMigration = fs.readFileSync(new URL('../supabase/migrations/20260827d_manager_notification_audit_repeats.sql', import.meta.url), 'utf8');
const endpoint = fs.readFileSync(new URL('../netlify/functions/manager-notifications.mjs', import.meta.url), 'utf8');
const participation = fs.readFileSync(new URL('../netlify/functions/manager-participation.mjs', import.meta.url), 'utf8');
const client = fs.readFileSync(new URL('../public/manager-notifications.js', import.meta.url), 'utf8');
const navigation = fs.readFileSync(new URL('../public/portal-navigation.js', import.meta.url), 'utf8');

test('notification foundation is manager-scoped, unread-aware and idempotent', () => {
  assert.ok(migration.includes('create table if not exists public.manager_notifications'));
  assert.ok(migration.includes("notification_class in ('info','action_required','reward','system')"));
  assert.ok(migration.includes('unique(manager_id, dedupe_key)'));
  assert.ok(migration.includes('mark_manager_notification_read_for_user'));
  assert.ok(endpoint.includes("body.action === 'mark-all-read'"));
  assert.ok(endpoint.includes("rpc('get_manager_notifications_for_user'"));
});

test('alpha feedback emits independent lifecycle events when one update changes several fields', () => {
  assert.ok(migration.includes("if new.status is distinct from old.status then"));
  assert.ok(migration.includes("if new.github_issue_url is distinct from old.github_issue_url"));
  assert.ok(migration.includes("if new.severity is distinct from old.severity"));
  assert.equal(migration.includes('elsif new.github_issue_url'), false);
  assert.ok(migration.includes("'status_triaged', 'Report confirmed'"));
  assert.ok(migration.includes("'promoted_to_github', 'Investigation opened'"));
  assert.ok(migration.includes("'status_fixed', 'Report fixed'"));
});

test('repeated lifecycle transitions receive unique audit identities', () => {
  assert.ok(auditRepeatMigration.includes('v_event_id uuid := gen_random_uuid()'));
  assert.ok(auditRepeatMigration.includes("p_event_type || ':' || v_event_id::text"));
  assert.ok(auditRepeatMigration.includes('insert into public.alpha_feedback_events'));
  assert.equal(auditRepeatMigration.includes('on conflict(dedupe_key) do nothing'), false);
});

test('bug hunter credit is based on confirmed impact rather than raw submissions', () => {
  assert.ok(migration.includes("when 'critical' then 8"));
  assert.ok(migration.includes("when 'high' then 4"));
  assert.ok(migration.includes("when 'medium' then 2"));
  assert.ok(migration.includes("new.status in ('triaged','fixed')"));
  assert.ok(migration.includes("new.kind = 'bug'"));
  assert.ok(migration.includes('greatest(public.alpha_feedback_bug_credits.points, excluded.points)'));
  for (const key of ['bug_spotter','bug_hunter','bug_detective','match_saver','game_saver','alpha_pioneer']) {
    assert.ok(migration.includes(`'key','${key}'`));
  }
});

test('bug hunter pins join the existing manager pin system without exposing private points publicly', () => {
  assert.ok(participation.includes('get_manager_bug_hunter_for_user'));
  assert.ok(participation.includes('result.pins = ['));
  assert.ok(migration.includes("case when v_target=v_caller then jsonb_build_object('points'"));
  assert.ok(migration.includes('else null end'));
});

test('portal exposes a notification bell and My reports timeline', () => {
  assert.ok(navigation.includes("import './manager-notifications.js';"));
  assert.ok(navigation.includes("installStylesheet('./manager-notifications.css')"));
  assert.ok(client.includes("button.id = 'managerNotificationsButton'"));
  assert.ok(client.includes("data-tab=\"reports\""));
  assert.ok(client.includes("Bug Hunter"));
  assert.ok(client.includes("Open engineering issue ↗"));
  assert.ok(client.includes('window.setInterval(() => void refresh(), 60_000)'));
});

test('marking an inert notification read refreshes the visible inbox immediately', () => {
  assert.ok(client.includes("await mutate({ action: 'mark-read', notification_id: item.id });"));
  assert.ok(client.includes('await refresh(true, true);'));
});

test('existing alpha reports are backfilled into history and reward credit', () => {
  assert.ok(migration.includes('-- Backfill existing alpha reports'));
  assert.ok(migration.includes("'alpha_feedback:' || id::text || ':submitted'"));
  assert.ok(migration.includes("status in ('triaged','fixed') and severity is not null"));
  assert.ok(migration.includes('-- Backfill only meaningful current-state notifications'));
});
