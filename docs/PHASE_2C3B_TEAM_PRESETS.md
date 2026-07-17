# Phase 2C.3b — Last-team carry-forward and saved team sheets

## Deployment

1. Merge PR #28.
2. Run `supabase/migrations/20260717_phase_2c3b_team_sheet_presets.sql` in Supabase.
3. Deploy the Netlify preview or production build.

## Behaviour

- When a scheduled fixture has no submission, the portal loads the club's most recently submitted or locked team.
- Formation, ordered XI, bench, captain, set pieces and tactics are carried forward.
- The carried-forward selection is only a starting point. It is not submitted for the new fixture until the manager presses **Save team and tactics**.
- If a player is no longer present in the selectable squad, that player is omitted and the manager must complete a valid team.
- An existing submission for the current fixture always takes priority over carry-forward.

## Saved team sheets

Managers can:

- save the current selection under a name;
- load a saved team sheet into the current fixture;
- update the selected preset from the current screen;
- delete a preset;
- alter a loaded preset for one fixture without changing the saved copy.

Each preset stores formation, exact XI slot order, bench order, captain, set-piece takers and tactical settings. Presets belong to one manager and one actively managed club.

## Preview test

1. Ensure the manager has a previous submitted or locked fixture and a new scheduled fixture with no submission.
2. Open **Tactics & Team**.
3. Confirm the previous XI, bench, captain, formation and tactics appear with **CARRIED FORWARD**.
4. Change one player and save the new fixture submission.
5. Reload and confirm the current fixture submission, not the older team, is restored.
6. Save the current screen as `Best XI`.
7. Change formation and players, then load `Best XI`; confirm the exact saved arrangement returns.
8. Update `Best XI`, reload, and confirm the new version persists.
9. Delete `Best XI` and confirm it disappears.

## Security

RLS limits presets to the authenticated manager. Inserts and updates additionally require an active appointment to the preset's club. Both API endpoints verify the authenticated profile and active club appointment.