import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(
  new URL('../supabase/migrations/20260922_tbg_comms_phase_a.sql', import.meta.url),
  'utf8'
);

test('Phase A creates only the bounded private conversation domain', () => {
  assert.match(migration, /create table if not exists public\.conversations/i);
  assert.match(migration, /create table if not exists public\.conversation_members/i);
  assert.match(migration, /create table if not exists public\.conversation_messages/i);
  assert.match(migration, /conversation_type in \('direct'\)/i);
  assert.doesNotMatch(migration, /create table if not exists public\.transfer_listings/i);
  assert.doesNotMatch(migration, /web.?push|notification.*insert|manager_notifications.*insert/is);
});

test('private conversation tables fail closed and expose read-only RLS to authenticated users', () => {
  for (const table of ['conversations', 'conversation_members', 'conversation_messages']) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, 'i'));
    assert.match(migration, new RegExp(`revoke all on public\\.${table} from public, anon, authenticated`, 'i'));
    assert.match(migration, new RegExp(`grant select on public\\.${table} to authenticated`, 'i'));
    assert.doesNotMatch(
      migration,
      new RegExp(`grant [^;]*(?:insert|update|delete)[^;]*on public\\.${table} to authenticated`, 'i')
    );
  }

  assert.match(migration, /create schema if not exists private/i);
  assert.match(migration, /private\.manager_can_read_conversation/i);
  assert.match(migration, /security definer[\s\S]*set search_path = ''/i);
  assert.match(migration, /profile\.user_id = \(select auth\.uid\(\)\)/i);
  assert.match(migration, /profile\.status = 'active'/i);
});

test('RLS grants no private metadata to non-members', () => {
  assert.match(
    migration,
    /create policy "conversation members can read conversations"[\s\S]*private\.manager_can_read_conversation\(id\)/i
  );
  assert.match(
    migration,
    /create policy "conversation members can read membership"[\s\S]*private\.manager_can_read_conversation\(conversation_id\)/i
  );
  assert.match(
    migration,
    /create policy "conversation members can read messages"[\s\S]*private\.manager_can_read_conversation\(conversation_id\)/i
  );
});

test('direct conversation creation is identity-controlled and same-world human-only', () => {
  assert.match(migration, /create or replace function public\.start_direct_conversation/i);
  assert.match(migration, /profile\.user_id = \(select auth\.uid\(\)\)/i);
  assert.match(migration, /appointment\.world_id = p_world_id/i);
  assert.match(migration, /appointment\.status = 'active'/i);
  assert.match(migration, /appointment\.control_type = 'human'/i);
  assert.match(migration, /caller_manager_id = p_other_manager_id/i);
  assert.match(migration, /least\(caller_manager_id::text, p_other_manager_id::text\)[\s\S]*greatest\(caller_manager_id::text, p_other_manager_id::text\)/i);
  assert.match(migration, /conversations_direct_pair_uidx/i);
});

test('message send snapshots historical affiliation and cannot accept a spoofed sender', () => {
  assert.match(migration, /sender_appointment_id uuid references public\.manager_appointments/i);
  assert.match(migration, /sender_club_id text references public\.clubs/i);
  assert.match(migration, /sender_display_name text not null/i);
  assert.match(migration, /select profile\.id, appointment\.id, appointment\.club_id, profile\.display_name/i);
  assert.match(migration, /profile\.user_id = \(select auth\.uid\(\)\)/i);
  assert.doesNotMatch(migration, /p_sender_manager_id|p_sender_club_id|p_sender_appointment_id/i);
});

test('message sequencing and read advancement serialize on the same conversation row', () => {
  assert.match(migration, /last_message_seq bigint not null default 0/i);
  assert.match(migration, /message_seq bigint not null check \(message_seq > 0\)/i);
  assert.match(migration, /last_read_message_seq bigint not null default 0/i);

  const sendStart = migration.indexOf('create or replace function public.send_conversation_message');
  const readStart = migration.indexOf('create or replace function public.mark_conversation_read');
  const sendSql = migration.slice(sendStart, readStart);
  const readSql = migration.slice(readStart);

  assert.match(sendSql, /from public\.conversations[\s\S]*where id = p_conversation_id[\s\S]*for update/i);
  assert.match(sendSql, /set last_message_seq = last_message_seq \+ 1/i);
  assert.match(sendSql, /last_read_message_seq = greatest\(last_read_message_seq, next_seq\)[\s\S]*manager_id = caller_manager_id/i);
  assert.match(readSql, /from public\.conversations[\s\S]*where id = p_conversation_id[\s\S]*for update/i);
  assert.match(readSql, /p_message_seq > conversation_row\.last_message_seq/i);
  assert.match(readSql, /last_read_message_seq = greatest\(last_read_message_seq, p_message_seq\)/i);
});

test('message API is idempotent and RPC execution is authenticated-only', () => {
  assert.match(migration, /client_request_id text/i);
  assert.match(migration, /conversation_messages_request_uidx/i);
  assert.match(migration, /message\.client_request_id = clean_request_key/i);

  for (const signature of [
    'start_direct_conversation\\(text, uuid\\)',
    'send_conversation_message\\(uuid, text, text\\)',
    'mark_conversation_read\\(uuid, bigint\\)'
  ]) {
    assert.match(migration, new RegExp(`revoke all on function public\\.${signature}\\s+from public, anon, authenticated`, 'i'));
    assert.match(migration, new RegExp(`grant execute on function public\\.${signature}\\s+to authenticated`, 'i'));
  }
});

test('conversation free text remains mechanically inert', () => {
  assert.doesNotMatch(migration, /manager_world_commands\s*\(/i);
  assert.doesNotMatch(migration, /transfer_deals\s*\(/i);
  assert.doesNotMatch(migration, /interest_score|professionalism|player_reaction/i);
});
