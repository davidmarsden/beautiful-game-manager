# Phase 2C.2b setup

This release adds first-login onboarding, persistent manager submissions, inbox metadata and live fixture deadlines.

## 1. Apply the migration

Open Supabase → SQL Editor and run:

`supabase/migrations/20260716_phase_2c2b_gameplay_loop.sql`

This adds manager profile fields, `manager_submissions`, RLS policies, deadline locking support and an initial welcome message.

## 2. Add or verify a fixture

The portal shows the next scheduled fixture involving the manager's appointed club. A fixture needs:

- `status = 'scheduled'`
- `kickoff_at`
- `submission_deadline_at`
- home and away club IDs that exist in `public.clubs`

Example:

```sql
insert into public.fixtures (
  id, world_id, season_id, competition_id,
  home_club_id, away_club_id, matchday,
  kickoff_at, submission_deadline_at, status
)
values (
  'season-1-md1-demo', 'tbg-world-1', 'season-1', 'division-1',
  'tbg-club-001', 'tbg-club-002', 1,
  now() + interval '3 days',
  now() + interval '2 days 20 hours',
  'scheduled'
)
on conflict (id) do update set
  kickoff_at = excluded.kickoff_at,
  submission_deadline_at = excluded.submission_deadline_at,
  status = excluded.status;
```

Use real club IDs from `public.clubs`.

## 3. Test on the Netlify preview

1. Sign in.
2. An incomplete profile sees onboarding once.
3. Complete the profile.
4. Open the assigned club.
5. Confirm the inbox unread badge and deadline countdown.
6. Submit a valid XI and tactics.
7. Reload and confirm the saved submission is restored with its version.
8. Submit again before the deadline and confirm the version increments.
9. Move the deadline into the past and confirm the controls lock.

## Security

- Managers can read only their own submissions.
- Managers can insert/update submissions only for their active club appointment.
- The Netlify function independently verifies identity, appointment, fixture involvement and deadline before persistence.
- No Supabase service-role key is exposed to the browser.
