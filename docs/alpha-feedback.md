# Controlled-alpha feedback flow

The primary tester support route is in-game.

1. A signed-in manager opens **Report / feedback** from the Manager Portal.
2. The browser submits to `/api/alpha-feedback` with the existing Supabase bearer token.
3. The Netlify function validates the user with Supabase Auth and calls the service-only `submit_alpha_feedback_for_user` RPC.
4. The report is stored in `alpha_feedback_reports`, outside canonical world state/checksum mutation.
5. The server derives manager and active club identity. The client supplies only the report text plus non-secret diagnostic context such as route, viewport and user agent.
6. Alpha admins review reports at `/alpha-feedback-admin.html`, set status/severity/private notes, and may attach a GitHub issue URL if a report is promoted into engineering work.

The GitHub issue form remains an internal/fallback route; testers do not need a GitHub account to participate.

## Privacy and safety

Do not collect passwords, magic links, access tokens, refresh tokens or service credentials in reports. The feedback table has RLS enabled with no browser policies; reads/writes happen only through authenticated server functions and service-only RPCs. Input lengths and submission rate are bounded.

Screenshot upload is deliberately deferred from the first in-game version. Managers can submit the report immediately and share a screenshot separately when it is useful.
