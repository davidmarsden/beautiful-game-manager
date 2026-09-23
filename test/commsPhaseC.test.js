import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(new URL('../supabase/migrations/20260923b_tbg_comms_phase_c.sql', import.meta.url), 'utf8');
const endpoint = fs.readFileSync(new URL('../netlify/functions/object-discussion.mjs', import.meta.url), 'utf8');
const ui = fs.readFileSync(new URL('../public/object-discussions.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../public/object-discussions.css', import.meta.url), 'utf8');
const navigation = fs.readFileSync(new URL('../public/portal-navigation.js', import.meta.url), 'utf8');
const squad = fs.readFileSync(new URL('../public/squad-view.js', import.meta.url), 'utf8');

test('Phase C binds only the approved canonical object types', () => {
  assert.match(migration, /object_type in \('player','club','fixture','news'\)/i);
  assert.match(migration, /world_feed_object_discussion_uidx/i);
  assert.match(migration, /world_id, object_type, object_id/i);
  assert.match(migration, /item_type = 'object_discussion'/i);
});

test('object existence is verified server-side against canonical TBG sources', () => {
  assert.match(migration, /from public\.clubs club[\s\S]*club\.world_id = p_world_id[\s\S]*club\.id = normalized_id/i);
  assert.match(migration, /from public\.fixtures fixture[\s\S]*fixture\.world_id = p_world_id[\s\S]*fixture\.id = normalized_id/i);
  assert.match(migration, /from public\.world_feed_items item[\s\S]*item\.id::text = normalized_id/i);
  assert.match(migration, /canonical_world_saves[\s\S]*squad_cycle'[\s\S]*players'[\s\S]*\? normalized_id/i);
});

test('titles and URLs are presentation metadata rather than object identity', () => {
  assert.match(migration, /object_id text/i);
  assert.match(migration, /object_title text/i);
  assert.match(migration, /source_key[\s\S]*'object-discussion:' \|\| normalized_type \|\| ':' \|\| normalized_id/i);
  assert.doesNotMatch(migration, /object_url/i);
});

test('object discussion reuses World Feed comments but does not appear in News', () => {
  assert.match(migration, /insert into public\.world_feed_comments/i);
  assert.match(migration, /comment\.feed_item_id = discussion_id/i);
  assert.match(migration, /item\.item_type <> 'object_discussion'/i);
  assert.match(migration, /comment_item\.item_type <> 'object_discussion'/i);
});

test('object discussion remains non-authoritative', () => {
  assert.match(migration, /'authority', 'discussion_only'/i);
  assert.doesNotMatch(migration, /insert into public\.manager_world_commands/i);
  assert.doesNotMatch(migration, /update public\.canonical_world_saves/i);
  assert.doesNotMatch(migration, /insert into public\.transfer_deals/i);
  assert.doesNotMatch(migration, /professionalism|player_reaction|interest_score/i);
});

test('object discussion RPC surface is service-only', () => {
  for (const signature of [
    'ensure_object_discussion_for_user\\(uuid,text,text,text,text\\)',
    'get_object_discussion_for_user\\(uuid,text,text,text,text\\)',
    'create_object_discussion_comment_for_user\\(uuid,text,text,text,text,text,uuid\\)'
  ]) {
    assert.match(migration, new RegExp(`revoke all on function public\\.${signature}[\\s\\S]*from public, anon, authenticated`, 'i'));
    assert.match(migration, new RegExp(`grant execute on function public\\.${signature} to service_role`, 'i'));
  }
});

test('API validates auth then passes canonical object fields to service RPCs', () => {
  assert.match(endpoint, /\/auth\/v1\/user/);
  assert.match(endpoint, /\['player', 'club', 'fixture', 'news'\]/);
  assert.match(endpoint, /get_object_discussion_for_user/);
  assert.match(endpoint, /create_object_discussion_comment_for_user/);
  assert.match(endpoint, /p_object_type: objectType/);
  assert.match(endpoint, /p_object_id: objectId/);
});

test('browser exposes discussions from player club fixture and news surfaces', () => {
  assert.match(ui, /addPlayerActions/);
  assert.match(ui, /addClubActions/);
  assert.match(ui, /addFixtureActions/);
  assert.match(ui, /addNewsActions/);
  assert.match(ui, /\.tbg-player-profile\[data-player-id\]/);
  assert.match(ui, /#historyClubPanel/);
  assert.match(ui, /\[data-match-centre\]/);
  assert.match(ui, /\[data-feed-item-id\]/);
  assert.match(squad, /data-club-id=/);
  assert.match(navigation, /import '\.\/object-discussions\.js'/);
  assert.match(navigation, /object-discussions\.css/);
  assert.match(css, /\.object-discussion-dialog/);
});

test('public discussion UI states the authority boundary', () => {
  assert.match(ui, /Discussion never changes game state/);
  assert.match(ui, /not a formal football action/);
  assert.doesNotMatch(ui, /submit.*offer|manager_world_commands|transfer_offer/i);
});

test('reply notifications deep-link back to canonical object discussion', () => {
  assert.match(migration, /'object_discussion_reply'/);
  assert.match(migration, /discussion_type=' \|\| normalized_type \|\| '&discussion_id=' \|\| normalized_id/i);
  assert.match(ui, /discussion_type/);
  assert.match(ui, /discussion_id/);
});


test('dynamic decoration includes inserted roots as well as descendants', () => {
  assert.match(ui, /function matchesAndDescendants\(root, selector\)/);
  assert.match(ui, /root\?\.matches\?\.\(selector\)/);
  assert.match(ui, /matchesAndDescendants\(root, '#historyClubPanel'\)/);
  assert.match(ui, /matchesAndDescendants\(root, '\[data-feed-item-id\]'\)/);
});

test('fixture discussion controls stay inside valid table row markup', () => {
  assert.match(ui, /if \(trigger\.tagName === 'TR'\)/);
  assert.match(ui, /document\.createElement\('td'\)/);
  assert.match(ui, /cell\.dataset\.fixtureDiscussionCell/);
  assert.match(ui, /trigger\.append\(cell\)/);
  assert.match(ui, /cell\.append\(button\)/);
});

test('generated object-discussion feed title respects the 160 character constraint', () => {
  assert.match(migration, /left\('Discussion · ' \|\| normalized_title, 160\)/);
});
