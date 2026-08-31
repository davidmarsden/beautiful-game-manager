import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('manual Bug Hunter award RPC creates a normal triaged bug report', async () => {
  const migration = await read('supabase/migrations/20260831_manual_bug_hunter_awards.sql');
  assert.match(migration, /admin_award_external_bug_credit/);
  assert.match(migration, /p_manager_id uuid/);
  assert.match(migration, /p_severity text/);
  assert.match(migration, /p_reason text/);
  assert.match(migration, /p_source_channel text/);
  assert.match(migration, /insert into public\.alpha_feedback_reports/);
  assert.match(migration, /'bug'/);
  assert.match(migration, /'triaged'/);
  assert.match(migration, /'External tester report'/);
  assert.match(migration, /'external_admin_award'/);
  assert.match(migration, /public\.alpha_feedback_points\(p_severity\)/);
});

test('manual Bug Hunter awards are admin-only and target active world managers', async () => {
  const migration = await read('supabase/migrations/20260831_manual_bug_hunter_awards.sql');
  assert.match(migration, /not v_admin\.is_admin/);
  assert.match(migration, /a\.world_id = p_world_id/);
  assert.match(migration, /a\.manager_id = p_manager_id/);
  assert.match(migration, /a\.status = 'active'/);
  assert.match(migration, /manager_not_active_in_world/);
  assert.match(migration, /grant execute on function public\.admin_award_external_bug_credit[\s\S]*service_role/);
});

test('alpha feedback admin context exposes active managers for award selection', async () => {
  const migration = await read('supabase/migrations/20260831_manual_bug_hunter_awards.sql');
  assert.match(migration, /'managers', v_managers/);
  assert.match(migration, /m\.display_name as manager_name/);
  assert.match(migration, /c\.name as club_name/);
});

test('admin endpoint routes external awards through the protected RPC', async () => {
  const endpoint = await read('netlify/functions/alpha-feedback-admin.mjs');
  assert.match(endpoint, /payload\.action === 'award-external-bug'/);
  assert.match(endpoint, /rpc\('admin_award_external_bug_credit'/);
  assert.match(endpoint, /p_manager_id: clean\(payload\.manager_id\)/);
  assert.match(endpoint, /p_reason: clean\(payload\.reason\)/);
  assert.match(endpoint, /p_source_channel: clean\(payload\.source_channel\)/);
});

test('alpha admin UI can award an external Bug Hunter credit with manager, impact, channel and reason', async () => {
  const html = await read('public/alpha-feedback-admin.html');
  const js = await read('public/alpha-feedback-admin.js');
  assert.match(html, /Award Bug Hunter credit/);
  assert.match(html, /id="bugAwardManager"/);
  assert.match(html, /id="bugAwardSeverity"/);
  assert.match(html, /id="bugAwardChannel"/);
  assert.match(html, /id="bugAwardReason"/);
  assert.match(js, /action:'award-external-bug'/);
  assert.match(js, /Bug Hunter credit awarded/);
  assert.match(js, /external_admin_award/);
});

test('award success is preserved even if the admin list refresh fails', async () => {
  const js = await read('public/alpha-feedback-admin.js');
  assert.match(js, /let result;try\{result=await api\(/);
  assert.match(js, /const success=`Bug Hunter credit awarded/);
  assert.match(js, /The award is saved, but the list could not refresh/);
  assert.match(js, /try\{await load\(\);\$\('feedbackAdminStatus'\)\.textContent=success;\}catch/);
});
