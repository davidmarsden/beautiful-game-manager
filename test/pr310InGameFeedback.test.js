import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('#310 feedback is submitted in-game and stored outside canonical world state', () => {
  const migration = read('supabase/migrations/20260825a_alpha_feedback_reports.sql');
  const client = read('public/alpha-feedback.js');
  const endpoint = read('netlify/functions/alpha-feedback.mjs');

  assert.match(migration, /create table if not exists public\.alpha_feedback_reports/);
  assert.match(migration, /alter table public\.alpha_feedback_reports enable row level security/);
  assert.match(migration, /submit_alpha_feedback_for_user/);
  assert.doesNotMatch(migration, /canonical_world_saves/);
  assert.match(client, /Report \/ feedback/);
  assert.match(client, /no GitHub account needed/i);
  assert.match(client, /client_context/);
  assert.match(endpoint, /authenticatedUser/);
  assert.match(endpoint, /submit_alpha_feedback_for_user/);
});

test('#310 feedback capture excludes secrets and has bounded input/rate limits', () => {
  const migration = read('supabase/migrations/20260825a_alpha_feedback_reports.sql');
  const client = read('public/alpha-feedback.js');
  const endpoint = read('netlify/functions/alpha-feedback.mjs');

  assert.match(migration, /interval '1 hour'/);
  assert.match(migration, />= 20/);
  assert.match(migration, /feedback_too_long/);
  assert.match(client, /don't include passwords, magic links or other secrets/i);
  assert.match(endpoint, /CLIENT_CONTEXT_LIMIT\s*=\s*8192/);
  for (const key of ['path', 'page_area', 'user_agent', 'viewport', 'language', 'local_time']) {
    assert.match(endpoint, new RegExp(`${key}:\\s*\\d+`));
  }
  assert.match(endpoint, /JSON\.stringify\(value\)/);
  assert.match(endpoint, /Client context is too large/);
  assert.match(endpoint, /boundedClientContext\(payload\.client_context\)/);
});

test('#310 provides admin-only feedback triage and optional GitHub promotion', () => {
  const migration = read('supabase/migrations/20260825a_alpha_feedback_reports.sql');
  const adminPage = read('public/alpha-feedback-admin.html');
  const adminClient = read('public/alpha-feedback-admin.js');
  const adminEndpoint = read('netlify/functions/alpha-feedback-admin.mjs');

  assert.match(migration, /get_alpha_feedback_admin_context_for_user/);
  assert.match(migration, /not v_admin\.is_admin/);
  assert.match(migration, /github_issue_url/);
  assert.match(adminPage, /Alpha feedback triage/);
  assert.match(adminClient, /GitHub issue URL \(optional\)/);
  assert.match(adminClient, /Anything else/);
  assert.match(adminClient, /Captured diagnostics/);
  assert.match(adminClient, /client_context/);
  assert.match(adminClient, /Browser \/ device/);
  assert.match(adminClient, /Create GitHub issue/);
  assert.match(adminClient, /rowPayload\(row,'promote'\)/);
  assert.match(adminClient, /Open GitHub issue/);
  assert.match(adminEndpoint, /admin_update_alpha_feedback_report/);
  assert.match(adminEndpoint, /process\.env\.GITHUB_TOKEN/);
  assert.match(adminEndpoint, /api\.github\.com\/repos\/\$\{GITHUB_REPOSITORY\}\/issues/);
  assert.match(adminEndpoint, /alpha-feedback-report:\$\{report\.id\}/);
  assert.match(adminEndpoint, /Private admin notes and reporter contact details are deliberately not copied to GitHub/);
});

test('#310 GitHub promotion recovers existing links and recent issue markers before creating again', () => {
  const adminEndpoint = read('netlify/functions/alpha-feedback-admin.mjs');

  assert.match(adminEndpoint, /if \(stored\.github_issue_url\)/);
  assert.match(adminEndpoint, /latestMatchingGithubIssue\(report\.id\)/);
  assert.match(adminEndpoint, /issues\?state=all&per_page=100&sort=created&direction=desc/);
  assert.match(adminEndpoint, /report\.status === 'new' \? 'triaged' : report\.status/);
});

test('#310 guide makes in-game reporting primary without explaining GitHub signup', () => {
  const guide = read('public/alpha-guide.html');
  const auth = read('public/auth-entry.js');

  assert.match(guide, /<p>Use <strong>Report \/ feedback<\/strong> in the Manager Portal\.<\/p>/);
  assert.doesNotMatch(guide, /does not require a GitHub account/i);
  assert.doesNotMatch(guide, /issues\/new\?template=controlled-alpha-bug/);
  assert.match(auth, /alpha-feedback\.js/);
});
