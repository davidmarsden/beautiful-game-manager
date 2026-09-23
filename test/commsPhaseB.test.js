import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(new URL('../supabase/migrations/20260923_tbg_comms_phase_b.sql', import.meta.url), 'utf8');
const endpoint = fs.readFileSync(new URL('../netlify/functions/comms.mjs', import.meta.url), 'utf8');
const ui = fs.readFileSync(new URL('../public/comms.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../public/comms.css', import.meta.url), 'utf8');
const navigation = fs.readFileSync(new URL('../public/portal-navigation.js', import.meta.url), 'utf8');
const directory = fs.readFileSync(new URL('../public/manager-directory.js', import.meta.url), 'utf8');

test('Phase B exposes sanitized service-only conversation projections', () => {
  assert.match(migration, /get_manager_comms_for_user\(\s*p_user_id uuid,\s*p_world_id text/i);
  assert.match(migration, /get_manager_conversation_for_user\(/i);
  assert.match(migration, /grant execute on function public\.get_manager_comms_for_user\(uuid, text\) to service_role/i);
  assert.match(migration, /grant execute on function public\.get_manager_conversation_for_user\(uuid, text, uuid, integer\) to service_role/i);
  assert.match(migration, /revoke all on function public\.get_manager_comms_for_user\(uuid, text\)[\s\S]*public, anon, authenticated/i);
  assert.doesNotMatch(migration, /'other_last_read_message_seq'|'other_muted_at'|'other_left_at'/i);
});

test('overview unread state belongs only to the caller', () => {
  assert.match(migration, /self_member\.last_read_message_seq/i);
  assert.match(migration, /message\.message_seq > self_member\.last_read_message_seq/i);
  assert.match(migration, /message\.sender_manager_id is distinct from caller_manager_id/i);
  assert.match(migration, /'muted', self_member\.muted_at is not null/i);
});

test('block and report tables are private and mechanically inert', () => {
  for (const table of ['manager_communication_blocks', 'conversation_reports']) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, 'i'));
    assert.match(migration, new RegExp(`revoke all on public\\.${table} from public, anon, authenticated`, 'i'));
    assert.doesNotMatch(migration, new RegExp(`grant [^;]*on public\\.${table} to authenticated`, 'i'));
  }
  assert.doesNotMatch(migration, /insert into public\.manager_world_commands/i);
  assert.doesNotMatch(migration, /update public\.transfer_deals/i);
  assert.doesNotMatch(migration, /interest_score|professionalism|player_reaction/i);
});

test('ordinary DM blocks apply in either direction without blocking game obligations', () => {
  assert.match(migration, /manager_direct_pair_blocked/i);
  assert.match(migration, /blocker_manager_id = p_manager_a[\s\S]*blocked_manager_id = p_manager_b/i);
  assert.match(migration, /blocker_manager_id = p_manager_b[\s\S]*blocked_manager_id = p_manager_a/i);
  assert.match(migration, /start_direct_conversation[\s\S]*manager_direct_pair_blocked/i);
  assert.match(migration, /send_conversation_message[\s\S]*manager_direct_pair_blocked/i);
  assert.doesNotMatch(migration, /manager_messages[\s\S]*(?:delete|update).*block/is);
});

test('unblocking remains possible even when the target no longer has an active appointment', () => {
  const fn = migration.slice(
    migration.indexOf('create or replace function public.set_manager_communication_block'),
    migration.indexOf('create or replace function public.report_conversation_message')
  );
  assert.match(fn, /if p_blocked and not exists/i);
  assert.doesNotMatch(fn, /if not exists[\s\S]*then[\s\S]*delete from public\.manager_communication_blocks/i);
});

test('new DM notifications use existing notification classes and social email preferences', () => {
  assert.match(migration, /'direct_message',\s*'info'/i);
  assert.match(migration, /recipient\.muted_at is null/i);
  assert.match(migration, /'\/?\?view=comms&conversation='| '\/\?view=comms&conversation='/i);
  assert.match(migration, /p_notification_type, ''\) = 'direct_message' then 'social'/i);
  assert.doesNotMatch(migration, /'direct_message',\s*'social'/i);
});

test('Comms API validates the Supabase user then separates service reads from user-authorized writes', () => {
  assert.match(endpoint, /\/auth\/v1\/user/);
  assert.match(endpoint, /serviceRpc\('get_manager_comms_for_user'/);
  assert.match(endpoint, /serviceRpc\('get_manager_conversation_for_user'/);
  assert.match(endpoint, /userRpc\(token, 'start_direct_conversation'/);
  assert.match(endpoint, /userRpc\(token, 'send_conversation_message'/);
  assert.match(endpoint, /userRpc\(token, 'mark_conversation_read'/);
  assert.match(endpoint, /userRpc\(token, 'set_conversation_muted'/);
  assert.match(endpoint, /userRpc\(token, 'set_manager_communication_block'/);
  assert.match(endpoint, /userRpc\(token, 'report_conversation_message'/);
});

test('Messages is a first-class portal view and manager directory action', () => {
  assert.match(navigation, /import '\.\/comms\.js'/);
  assert.match(navigation, /\['comms', 'Messages'\]/);
  assert.match(navigation, /button\.id = 'commsNavButton'/);
  assert.match(navigation, /section\.id = 'commsView'/);
  assert.match(directory, /data-manager-message-id/);
  assert.match(directory, /searchParams\.set\('view', 'comms'\)/);
  assert.match(css, /\.comms-shell/);
});

test('Messages UI keeps conversation text separate from formal football actions', () => {
  assert.match(ui, /Messages are not bids, promises or formal game actions/);
  assert.match(ui, /action: 'send'/);
  assert.match(ui, /action: 'mark-read'/);
  assert.match(ui, /action: 'mute'/);
  assert.match(ui, /action: 'block'/);
  assert.match(ui, /action: 'report'/);
  assert.doesNotMatch(ui, /transfer_offer|manager_world_commands|submit.*bid/i);
});


test('notification delivery category preserves transfer and free-agent routing', () => {
  assert.match(migration, /as \$category\$[\s\S]*like 'transfer_%'[\s\S]*like 'free_agent_%'[\s\S]*then 'transfers'[\s\S]*like 'news_%'[\s\S]*= 'direct_message'[\s\S]*then 'social'[\s\S]*\$category\$;/i);
});

test('composer retains the same idempotency key for the same pending draft retry', () => {
  assert.match(ui, /let pendingSend = null/);
  assert.match(ui, /samePendingDraft[\s\S]*pendingSend\.conversationId === activeThread\.id[\s\S]*pendingSend\.message === message/i);
  assert.match(ui, /pendingSend\.requestKey/);
  assert.match(ui, /pendingSend = \{ conversationId: activeThread\.id, message, requestKey \}/);
  assert.match(ui, /textarea\.value = ''[\s\S]*pendingSend = null/);
});

test('browser history clears the active thread when the conversation parameter disappears', () => {
  assert.match(ui, /else if \(!id\) \{[\s\S]*activeThread = null;[\s\S]*pendingSend = null;[\s\S]*renderThread\(\)/i);
});
