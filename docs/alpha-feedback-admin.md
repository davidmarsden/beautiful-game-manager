# Alpha feedback triage

Admin triage is intentionally separate from the canonical football world.

The page at `/alpha-feedback-admin.html` lists the latest 100 feedback reports and allows an authenticated TBG admin to set:

- status: `new`, `triaged`, `fixed`, `wont_fix`;
- severity: `low`, `medium`, `high`, `critical`;
- a private admin note;
- an optional GitHub issue URL when the report is promoted into engineering work.

A GitHub issue is therefore an implementation detail of admin triage, not a prerequisite for a manager to report a problem.

## Promoting a report into engineering work

For reports that need code changes, use **Create GitHub issue** on the triage row. The server:

1. confirms the signed-in manager is an admin;
2. loads the stored feedback report server-side;
3. checks whether the report is already linked to a GitHub issue;
4. checks the repository's recent issues for the report marker to recover safely from a previous partial promotion;
5. creates a prefilled GitHub issue when necessary;
6. changes a `new` report to `triaged` and stores the issue URL back on the feedback report.

Once linked, the admin UI shows **Open GitHub issue** instead of another create button. The GitHub issue contains the manager-provided reproduction/expected/actual/report details plus the captured route where available. Reporter contact details, browser/device diagnostics and the private admin note are deliberately not copied into the public repository issue.

The GitHub issue body contains a private-to-the-workflow HTML marker in the form `alpha-feedback-report:<uuid>`. It is not rendered in the issue, but lets the promotion endpoint recognise a recently-created issue if a previous request created GitHub work before the feedback row was successfully updated.

## Configuration

Automatic promotion requires a Netlify environment variable named `GITHUB_TOKEN`. Use a fine-grained GitHub token with **Issues: Read and write** permission for `davidmarsden/beautiful-game-manager` (or the repository named by `GITHUB_REPOSITORY`). Do not expose this token to browser code.

If `GITHUB_TOKEN` is absent, normal feedback review and manual GitHub URL entry continue to work; only **Create GitHub issue** returns a configuration error.
