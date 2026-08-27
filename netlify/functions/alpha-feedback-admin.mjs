const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const WORLD_ID = process.env.TBG_WORLD_ID || 'tbg-world-1';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const GITHUB_REPOSITORY = process.env.GITHUB_REPOSITORY || 'davidmarsden/beautiful-game-manager';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
});
const bearerToken = (request) => {
  const header = request.headers.get('authorization') || '';
  return header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
};
const isJwt = (value) => String(value || '').split('.').length === 3;
const clean = (value) => String(value || '').trim();
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);
const truncate = (value, max = 120) => {
  const text = clean(value).replace(/\s+/g, ' ');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

async function authenticatedUser(token) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}` }
  });
  if (!response.ok) throw Object.assign(new Error('Session is invalid or expired'), { status: 401 });
  return response.json();
}

async function rpc(name, body) {
  const headers = { apikey: SUPABASE_SERVICE_ROLE_KEY, 'content-type': 'application/json', accept: 'application/json' };
  if (isJwt(SUPABASE_SERVICE_ROLE_KEY)) headers.authorization = `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`;
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST', headers, body: JSON.stringify(body)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(result.message || result.error || `Supabase returned ${response.status}`), { status: response.status });
  return result;
}

const githubHeaders = () => ({
  accept: 'application/vnd.github+json',
  authorization: `Bearer ${GITHUB_TOKEN}`,
  'content-type': 'application/json',
  'user-agent': 'the-beautiful-game-alpha-feedback',
  'x-github-api-version': '2022-11-28'
});

function githubIssueTitle(report) {
  const area = truncate(report.page_area || report.client_context?.path || 'Manager Portal', 55);
  const symptom = truncate(report.actual_result || report.note || report.action_taken || report.category || 'Alpha feedback', 70);
  return `[Alpha feedback] ${area}: ${symptom}`.slice(0, 180);
}

function githubIssueBody(report) {
  const section = (heading, value) => clean(value) ? `\n## ${heading}\n${clean(value)}\n` : '';
  const marker = `alpha-feedback-report:${report.id}`;
  const route = clean(report.client_context?.path);
  return [
    '<!-- Created from the private TBG alpha-feedback triage queue. -->',
    `<!-- ${marker} -->`,
    '',
    `**Type:** ${clean(report.kind) || 'feedback'}`,
    `**Category:** ${clean(report.category) || 'other'}`,
    `**Severity:** ${clean(report.severity) || 'not set'}`,
    `**Reported area:** ${clean(report.page_area) || 'not captured'}`,
    route ? `**Route:** \`${route}\`` : '',
    section('What the manager was doing', report.action_taken),
    section('Expected result', report.expected_result),
    section('Actual result', report.actual_result),
    section('Additional report detail', report.note),
    '\n---\nCreated from an in-game controlled-alpha report. Private admin notes and reporter contact details are deliberately not copied to GitHub.'
  ].filter(Boolean).join('\n');
}

async function latestMatchingGithubIssue(reportId) {
  const marker = `alpha-feedback-report:${reportId}`;
  const response = await fetch(`https://api.github.com/repos/${GITHUB_REPOSITORY}/issues?state=all&per_page=100&sort=created&direction=desc`, {
    headers: githubHeaders()
  });
  const result = await response.json().catch(() => []);
  if (!response.ok) throw Object.assign(new Error(result.message || `GitHub returned ${response.status}`), { status: 502 });
  return Array.isArray(result) ? result.find((issue) => clean(issue.body).includes(marker) && issue.html_url) : null;
}

async function createGithubIssue(report) {
  const existing = await latestMatchingGithubIssue(report.id);
  if (existing) return { issue_url: existing.html_url, issue_number: existing.number, existing: true };

  const response = await fetch(`https://api.github.com/repos/${GITHUB_REPOSITORY}/issues`, {
    method: 'POST',
    headers: githubHeaders(),
    body: JSON.stringify({ title: githubIssueTitle(report), body: githubIssueBody(report) })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(result.message || `GitHub returned ${response.status}`), { status: 502 });
  return { issue_url: result.html_url, issue_number: result.number, existing: false };
}

async function adminContext(userId) {
  const context = await rpc('get_alpha_feedback_admin_context_for_user', { p_user_id: userId, p_world_id: WORLD_ID });
  if (!context?.ok) throw Object.assign(new Error(context?.code || 'Admin access required'), { status: 403 });
  return context;
}

async function updateReport(userId, payload, githubIssueUrl = null) {
  const result = await rpc('admin_update_alpha_feedback_report', {
    p_admin_user_id: userId,
    p_report_id: payload.report_id,
    p_status: clean(payload.status),
    p_severity: clean(payload.severity) || null,
    p_admin_note: clean(payload.admin_note) || null,
    p_github_issue_url: githubIssueUrl || clean(payload.github_issue_url) || null
  });
  if (!result?.ok) throw Object.assign(new Error(result?.code || 'Admin update failed'), { status: result?.code === 'admin_required' ? 403 : 400 });
  return result;
}

async function reservePromotion(userId, reportId) {
  const result = await rpc('admin_reserve_alpha_feedback_promotion', {
    p_admin_user_id: userId,
    p_report_id: reportId
  });
  if (!result?.ok) {
    const status = result?.code === 'admin_required' ? 403 : result?.code === 'promotion_in_progress' ? 409 : 400;
    throw Object.assign(new Error(result?.code || 'Could not reserve feedback promotion'), { status });
  }
  return result;
}

async function finishPromotion(userId, report, payload, promotionToken, issueUrl) {
  const status = report.status === 'new' ? 'triaged' : report.status;
  const result = await rpc('admin_finish_alpha_feedback_promotion', {
    p_admin_user_id: userId,
    p_report_id: report.id,
    p_promotion_token: promotionToken,
    p_status: status,
    p_severity: report.severity || null,
    p_admin_note: clean(payload.admin_note) || null,
    p_github_issue_url: issueUrl
  });
  if (!result?.ok) throw Object.assign(new Error(result?.code || 'Could not finish feedback promotion'), { status: 409 });
  return result;
}

async function releasePromotion(userId, reportId, promotionToken) {
  if (!promotionToken) return;
  await rpc('admin_release_alpha_feedback_promotion', {
    p_admin_user_id: userId,
    p_report_id: reportId,
    p_promotion_token: promotionToken
  }).catch(() => {});
}

export default async (request) => {
  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'Supabase is not configured' }, 503);
    const token = bearerToken(request);
    if (!token) return json({ error: 'Authentication required' }, 401);
    const user = await authenticatedUser(token);

    if (request.method === 'GET') return json(await adminContext(user.id));
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

    const payload = await request.json().catch(() => ({}));
    if (payload.action !== 'promote') return json(await updateReport(user.id, payload));

    if (!GITHUB_TOKEN) return json({ error: 'GitHub promotion is not configured (missing GITHUB_TOKEN)' }, 503);
    const context = await adminContext(user.id);
    const stored = (context.reports || []).find((report) => report.id === payload.report_id);
    if (!stored) return json({ error: 'report_not_found' }, 404);

    if (stored.github_issue_url) {
      await updateReport(user.id, payload, stored.github_issue_url);
      return json({ ok: true, report_id: stored.id, issue_url: stored.github_issue_url, existing: true });
    }

    let promotionToken = null;
    try {
      const reservation = await reservePromotion(user.id, stored.id);
      if (reservation.already_linked) {
        await updateReport(user.id, payload, reservation.issue_url);
        return json({ ok: true, report_id: stored.id, issue_url: reservation.issue_url, existing: true });
      }
      promotionToken = reservation.promotion_token;

      const selectedSeverity = hasOwn(payload, 'severity') ? (clean(payload.severity) || null) : stored.severity;
      const report = {
        ...stored,
        severity: selectedSeverity,
        status: clean(payload.status) || stored.status
      };
      const github = await createGithubIssue(report);
      await finishPromotion(user.id, report, payload, promotionToken, github.issue_url);
      promotionToken = null;
      return json({ ok: true, report_id: report.id, ...github });
    } catch (error) {
      await releasePromotion(user.id, stored.id, promotionToken);
      throw error;
    }
  } catch (error) {
    return json({ error: error.message }, error.status || 500);
  }
};
