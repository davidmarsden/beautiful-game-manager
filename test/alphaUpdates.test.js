import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration=fs.readFileSync('supabase/migrations/20260903d_alpha_updates.sql','utf8');
const reviewFix=fs.readFileSync('supabase/migrations/20260903e_alpha_updates_review_fixes.sql','utf8');
const draftIntegrity=fs.readFileSync('supabase/migrations/20260903f_alpha_updates_draft_integrity.sql','utf8');
const publishIdempotency=fs.readFileSync('supabase/migrations/20260903g_alpha_update_publish_idempotency.sql','utf8');
const playerEndpoint=fs.readFileSync('netlify/functions/alpha-updates.mjs','utf8');
const adminEndpoint=fs.readFileSync('netlify/functions/alpha-updates-admin.mjs','utf8');
const portal=fs.readFileSync('public/alpha-updates.js','utf8');
const portalCss=fs.readFileSync('public/alpha-updates.css','utf8');
const admin=fs.readFileSync('public/alpha-updates-admin.js','utf8');
const adminHtml=fs.readFileSync('public/alpha-updates-admin.html','utf8');
const authEntry=fs.readFileSync('public/auth-entry.js','utf8');

test('published Alpha Updates expose curated public summaries, not triage notes',()=>{
  assert.match(migration,/create table if not exists public\.alpha_updates/i);
  assert.match(migration,/public_summary text not null/i);
  const playerRpc=reviewFix.slice(reviewFix.indexOf('create or replace function public.get_alpha_updates_for_user'),reviewFix.indexOf('create or replace function public.admin_save_alpha_update'));
  assert.doesNotMatch(playerRpc,/admin_note/i);
  assert.match(playerRpc,/attribution_name/i);
});

test('publishing is bundled into one world-feed item and one manager notification per update',()=>{
  assert.match(migration,/'alpha_update'::text/);
  assert.match(publishIdempotency,/alpha_update:/i);
  assert.match(publishIdempotency,/insert into public\.manager_messages/i);
  assert.match(publishIdempotency,/insert into public\.manager_notifications/i);
  assert.match(publishIdempotency,/on conflict\(manager_id, dedupe_key\) do nothing/i);
});

test('fresh publication retries reuse a client-generated update id and serialize before lookup',()=>{
  assert.match(admin,/function ensureUpdateId\(\)\{if\(!\$\('updateId'\)\.value\)\$\('updateId'\)\.value=crypto\.randomUUID\(\)/);
  assert.match(admin,/update_id:ensureUpdateId\(\)/);
  assert.match(publishIdempotency,/if p_update_id is null then[\s\S]*update_id_required/i);
  const advisoryIndex=publishIdempotency.indexOf('pg_advisory_xact_lock');
  const lookupIndex=publishIdempotency.indexOf('from public.alpha_updates\n  where id = p_update_id');
  assert.ok(advisoryIndex>=0&&lookupIndex>advisoryIndex);
});

test('published replay succeeds only when the complete committed payload matches',()=>{
  assert.match(publishIdempotency,/v_requested_items jsonb/);
  assert.match(publishIdempotency,/v_existing_items jsonb/);
  assert.match(publishIdempotency,/v_existing_items = v_requested_items/);
  assert.match(publishIdempotency,/trim\(v_existing_title\) = trim\(p_title\)/);
  assert.match(publishIdempotency,/coalesce\(trim\(v_existing_summary\), ''\) = coalesce\(trim\(p_summary\), ''\)/);
  assert.match(publishIdempotency,/published_payload_conflict/);
  const replayIndex=publishIdempotency.indexOf("'idempotent_replay', true");
  const conflictIndex=publishIdempotency.indexOf("'published_payload_conflict'");
  const broadcastIndex=publishIdempotency.indexOf('insert into public.world_feed_items');
  assert.ok(replayIndex>=0&&conflictIndex>replayIndex&&broadcastIndex>conflictIndex);
});

test('derived broadcast titles stay within shared title constraints',()=>{
  assert.match(publishIdempotency,/left\('Alpha update: ' \|\| trim\(p_title\), 160\)/i);
  assert.match(publishIdempotency,/left\('What''s New: ' \|\| trim\(p_title\), 160\)/i);
});

test('normal admin candidates exclude records already marked as duplicate',()=>{
  assert.match(draftIntegrity,/not ilike 'Duplicate of canonical report%'/i);
  assert.match(admin,/public_summary/);
  assert.match(admin,/credit tester/);
});

test('saved drafts retain linked reports outside the normal candidate window',()=>{
  assert.match(draftIntegrity,/draft_linked/i);
  assert.match(draftIntegrity,/u\.status = 'draft'/i);
  assert.match(draftIntegrity,/union\s+select id from draft_linked/i);
  assert.match(draftIntegrity,/i\.report_id is not null/i);
});

test('admin can add curated items that do not originate in feedback reports',()=>{
  assert.match(adminHtml,/Other changes/);
  assert.match(admin,/manualItems/);
  assert.match(admin,/report_id:null/);
  assert.match(adminEndpoint,/items\.length===0/);
});

test('draft publication is serialized and published updates cannot be reverted',()=>{
  assert.match(publishIdempotency,/for update;/i);
  assert.match(publishIdempotency,/published_updates_are_immutable/i);
  assert.match(publishIdempotency,/and status = 'draft'/i);
  assert.match(publishIdempotency,/draft_state_changed/i);
});

test('composer serializes writes and freezes every editable control while pending',()=>{
  assert.match(admin,/writeInFlight/);
  assert.match(admin,/if\(writeInFlight\)return/);
  assert.match(adminHtml,/id="composer"[^>]*aria-busy="false"/);
  assert.match(admin,/function freezeComposerControls\(busy\)/);
  assert.match(admin,/composer\.querySelectorAll\('input,textarea,select,button'\)\.forEach\(control=>\{control\.disabled=busy;\}\)/);
  assert.match(admin,/composer\.setAttribute\('aria-busy',String\(busy\)\)/);
  assert.match(admin,/function setWriteBusy\(busy\)\{writeInFlight=busy;freezeComposerControls\(busy\);\}/);
});

test('resetting the composer clears staged manual-entry fields',()=>{
  assert.match(admin,/function resetComposer\(\)\{[^}]*\$\('manualType'\)\.value='new';[^}]*\$\('manualSummary'\)\.value='';/);
});

test('successful publish resets the composer even while the write guard is active',()=>{
  assert.match(admin,/function resetComposer\(\)/);
  assert.match(admin,/if\(publish\)resetComposer\(\)/);
  assert.match(admin,/function clearDraft\(\)\{if\(writeInFlight\)return;resetComposer\(\);\}/);
});

test('committed mutations are applied locally before best-effort context refresh',()=>{
  const mutationIndex=admin.indexOf("const result=await api({method:'POST'");
  const localStateIndex=admin.indexOf("if(publish)resetComposer();else $('updateId').value=result.update_id",mutationIndex);
  const refreshIndex=admin.indexOf('refreshAfterMutation(result,publish)',mutationIndex);
  assert.ok(mutationIndex>=0&&localStateIndex>mutationIndex&&refreshIndex>localStateIndex);
  assert.match(admin,/The change was saved, but the list could not refresh/);
});

test('candidate and payload summaries are explicitly capped at 1000 characters',()=>{
  assert.match(admin,/const summaryText=\(v\)=>String\(v\?\?''\)\.slice\(0,1000\)/);
  assert.match(admin,/function candidateSummary\(r\)\{return summaryText\(/);
  assert.match(admin,/public_summary:summaryText\(row\.querySelector\('\.summary'\)\.value\.trim\(\)\)/);
});

test('complete published history stays visible so unread state can always be cleared',()=>{
  const playerRpc=reviewFix.slice(reviewFix.indexOf('create or replace function public.get_alpha_updates_for_user'),reviewFix.indexOf('create or replace function public.admin_save_alpha_update'));
  assert.doesNotMatch(playerRpc,/limit\s+30/i);
  assert.match(playerRpc,/unread_count/);
});

test('player and admin endpoints require authenticated Supabase sessions',()=>{
  assert.match(playerEndpoint,/auth\/v1\/user/);
  assert.match(adminEndpoint,/auth\/v1\/user/);
  assert.match(playerEndpoint,/get_alpha_updates_for_user/);
  assert.match(adminEndpoint,/admin_save_alpha_update/);
});

test('manager portal loads What’s New with unread badge support',()=>{
  assert.match(authEntry,/alpha-updates\.js/);
  assert.match(portal,/What's New/);
  assert.match(portal,/unread_count/);
  assert.match(portal,/mark-read/);
});

test('What’s New is high-contrast and preview-safe before database rollout',()=>{
  assert.match(portalCss,/\.alpha-updates-button\{[^}]*background:#2f6f9f!important[^}]*color:#fff!important[^}]*border-color:#f1d91f!important/s);
  assert.match(portal,/function unavailableMessage\(error\)/);
  assert.match(portal,/not active on this preview yet/);
  assert.doesNotMatch(portal,/list\.innerHTML=`<p class="alpha-updates-empty">\$\{esc\(error\.message\)\}<\/p>`/);
});
