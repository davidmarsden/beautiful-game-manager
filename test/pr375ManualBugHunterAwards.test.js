import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('tester contribution migration generalises the existing credit ledger without losing bug compatibility', async () => {
  const migration = await read('supabase/migrations/20260902_tester_contribution_credits.sql');
  assert.match(migration, /add column if not exists contribution_type/);
  assert.match(migration, /'bug','feature','ux','data','other'/);
  assert.match(migration, /admin_award_external_tester_credit/);
  assert.match(migration, /admin_award_external_bug_credit/);
  assert.match(migration, /contribution_type = 'bug'/);
  assert.match(migration, /v_all_count >= 1/);
  assert.match(migration, /'tester_contributions'/);
});

test('manual tester awards remain admin-only and target active world managers', async () => {
  const migration = await read('supabase/migrations/20260902_tester_contribution_credits.sql');
  assert.match(migration, /not v_admin\.is_admin/);
  assert.match(migration, /a\.world_id = p_world_id/);
  assert.match(migration, /a\.manager_id = p_manager_id/);
  assert.match(migration, /a\.status = 'active'/);
  assert.match(migration, /manager_not_active_in_world/);
  assert.match(migration, /grant execute on function public\.admin_award_external_tester_credit[\s\S]*service_role/);
});

test('non-bug tester contributions use 1-3 point contribution values while bug impact keeps its existing scale', async () => {
  const migration = await read('supabase/migrations/20260902_tester_contribution_credits.sql');
  assert.match(migration, /if p_points not in \(1,2,3\)/);
  assert.match(migration, /public\.alpha_feedback_points\(v_severity\)/);
  assert.match(migration, /points in \(1,2,3,4,8\)/);
});

test('admin endpoint routes general awards through the protected tester-credit RPC', async () => {
  const endpoint = await read('netlify/functions/alpha-feedback-admin.mjs');
  assert.match(endpoint, /payload\.action === 'award-external-contribution'/);
  assert.match(endpoint, /rpc\('admin_award_external_tester_credit'/);
  assert.match(endpoint, /p_contribution_type: contributionType/);
  assert.match(endpoint, /p_points: Number\(payload\.points\) \|\| 1/);
  assert.match(endpoint, /p_severity: clean\(payload\.severity\) \|\| null/);
  assert.match(endpoint, /payload\.action === 'award-external-bug'/);
});

test('alpha admin UI awards bug, feature, UX, data and other tester contributions', async () => {
  const html = await read('public/alpha-feedback-admin.html');
  const js = await read('public/alpha-feedback-admin.js');
  assert.match(html, /Award tester credit/);
  assert.match(html, /id="testerAwardManager"/);
  assert.match(html, /id="testerAwardType"/);
  assert.match(html, /Feature suggestion/);
  assert.match(html, /UX improvement/);
  assert.match(html, /Bug report/);
  assert.match(html, /Data issue/);
  assert.match(html, /Other contribution/);
  assert.match(html, /id="testerAwardImpact"/);
  assert.match(html, /id="testerAwardChannel"/);
  assert.match(html, /id="testerAwardReason"/);
  assert.match(js, /action:'award-external-contribution'/);
  assert.match(js, /major feature contribution · 3 points/);
  assert.match(js, /critical · 8 points/);
});

test('legacy external Bug Hunter awards keep their bug label without contribution_type context', async () => {
  const js = await read('public/alpha-feedback-admin.js');
  assert.match(js, /context\.source==='external_admin_award'&&fallbackKind==='bug'\?'bug':''/);
  assert.match(js, /contributionLabel\(r\.client_context,r\.kind\)/);
  assert.match(js, /contextBlock\(r\.client_context,r\.kind\)/);
});

test('bug-specific pins ignore non-bug tester contributions while Alpha Pioneer recognises either', async () => {
  const migration = await read('supabase/migrations/20260902_tester_contribution_credits.sql');
  assert.match(migration, /contribution_type='bug'/);
  assert.match(migration, /if v_count >= 1 then v_pins[\s\S]*'bug_spotter'/);
  assert.match(migration, /if v_all_count >= 1 then v_pins[\s\S]*'alpha_pioneer'/);
});

test('award success is preserved even if the admin list refresh fails', async () => {
  const js = await read('public/alpha-feedback-admin.js');
  assert.match(js, /let result;try\{result=await api\(/);
  assert.match(js, /const success=`\$\{label\} credit awarded/);
  assert.match(js, /The award is saved, but the list could not refresh/);
  assert.match(js, /try\{await load\(\);\$\('feedbackAdminStatus'\)\.textContent=success;\}catch/);
});
