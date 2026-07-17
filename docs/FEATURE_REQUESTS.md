# The Beautiful Game — Feature Requests Register

This register records accepted and proposed enhancements that do not belong in the immediate delivery milestone but should not be lost.

## Status values

- **Proposed** — captured for consideration.
- **Accepted** — agreed in principle, not yet scheduled.
- **Planned** — assigned to a roadmap phase.
- **Building** — active implementation work exists.
- **Completed** — delivered and verified.
- **Rejected** — considered and deliberately declined, with the reason retained.

---

## FR-001 — Goalkeeper up for late attacking set piece

**Status:** Accepted  
**Likely phase:** Constitutional Match Engine / advanced match states  
**Priority:** Later enhancement

When a team urgently needs a goal, its goalkeeper may join a late corner or suitable attacking free kick as a last throw of the dice.

### Trigger conditions

- The team is trailing.
- Normally 88′ or later, including stoppage time.
- The team wins a corner or suitable attacking free kick.
- The manager’s mentality or match-state logic permits the risk.
- The goalkeeper has not been substituted, dismissed or injured.

### Engine state

`goalkeeper_up_for_corner`

This must be an explicit match state. Goalkeepers must not be randomly selected for ordinary attacking events.

### Effects

- Adds another aerial target in the opposition penalty area.
- Slightly increases the attacking team’s chance of winning the first or second ball.
- Leaves the attacking team’s goal exposed during a turnover or clearance.
- Can produce goalkeeper shots, headers, assists or exceptionally rare goals.
- Can lead to an immediate counterattack into an empty net.

### Commentary examples

- “Courtois is coming forward for the corner.”
- “Even the goalkeeper is in the penalty area now.”
- “Courtois rises highest — just over!”
- “GOAL! THE GOALKEEPER HAS SCORED!”
- “City clear, and the goal is completely unguarded…”

### Related work

- PR #27 excludes goalkeepers from ordinary outfield commentary.
- This feature is the deliberate, match-state-driven exception.
