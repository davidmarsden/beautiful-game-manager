# Phase 2D.3 — Results, tables and competition state

## What this phase adds

- persistent competition standings;
- played, won, drawn, lost, goals for, goals against, goal difference and points;
- standard ordering by points, goal difference, goals scored and stable club ID;
- five-match form;
- atomic result finalisation and standings rebuild;
- dashboard last-result display;
- recent fixture history;
- manager-facing competition table.

The result worker writes events and manager messages first. A single Supabase transaction then marks the fixture and match run complete and rebuilds the affected competition table. If that transaction fails, the fixture remains retryable.

## Deployment

1. Run `supabase/migrations/20260716_phase_2d3_competition_state.sql` in Supabase.
2. Deploy the branch.
3. Reload the manager portal.

The migration backfills standings for matches already marked `played`, so the Real Madrid 1–2 Barcelona test appears immediately.

## Verification

```sql
select position, club_id, played, won, drawn, lost,
       goals_for, goals_against, goal_difference, points, form
from public.competition_standings
where world_id = 'tbg-world-1'
  and season_id = 'season-1'
  and competition_id = 'division-1'
order by position;
```

Expected from the first demo result:

- Barcelona: 3 points, W, goals 2–1;
- Real Madrid: 0 points, L, goals 1–2.

The portal should show:

- Real Madrid 1–2 Barcelona in **Last Fixture**;
- the completed fixture in **Recent Results**;
- Barcelona above Real Madrid in the competition table;
- the managed club row highlighted.
