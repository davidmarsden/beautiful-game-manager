# Fixture locking and AI fallback

## Deployment

1. Run `supabase/migrations/20260716_fixture_locking_ai_fallback.sql` in the Supabase SQL editor.
2. Add `SUPABASE_SERVICE_ROLE_KEY` to the Netlify production environment. Never expose this value in browser code.
3. Deploy the branch. Netlify runs `lock-fixtures` every five minutes.

## Behaviour

For each scheduled fixture whose `submission_deadline_at` has passed:

- the worker atomically claims the fixture;
- each club's latest manager submission is locked;
- when no submission exists, a deterministic AI fallback selects an available goalkeeper, the ten strongest available outfield players and up to seven substitutes;
- the fallback uses balanced 4-3-3-wide tactics;
- the final submission records `submission_source` and `lock_reason`;
- the manager receives either a team-locked or missed-deadline inbox message;
- the fixture is marked `submissions_lock_status = locked` only after both clubs have a locked submission.

Failed fixtures are marked `error` with `submissions_lock_error` for admin inspection instead of silently disappearing.

## Browser-only test

1. Create a fixture with a deadline a few minutes in the future.
2. Submit a team for one club only.
3. Wait until the deadline and scheduled worker have passed.
4. In Supabase, confirm both fixture clubs have one `manager_submissions` row with `status = locked`.
5. Confirm the submitted club has `submission_source = manager`.
6. Confirm the missing club has `submission_source = ai_fallback` and `lock_reason = missed_deadline`.
7. Reload the portal and confirm saving is disabled and the appropriate inbox message appears.
