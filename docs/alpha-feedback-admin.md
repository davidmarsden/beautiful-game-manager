# Alpha feedback triage

Admin triage is intentionally separate from the canonical football world.

The page at `/alpha-feedback-admin.html` lists the latest 100 feedback reports and allows an authenticated TBG admin to set:

- status: `new`, `triaged`, `fixed`, `wont_fix`;
- severity: `low`, `medium`, `high`, `critical`;
- a private admin note;
- an optional GitHub issue URL when the report is promoted into engineering work.

A GitHub issue is therefore an implementation detail of admin triage, not a prerequisite for a manager to report a problem.
