# The Beautiful Game — Feature Requests Register

This register records accepted and proposed enhancements that do not belong in the immediate delivery milestone but should not be lost.

Each feature request records:

- a stable feature ID;
- status;
- likely phase;
- the user-facing idea;
- rules and constraints;
- technical notes;
- related pull requests or constitutions.

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
**Likely phase:** Phase 2E — Constitutional Match Engine / advanced match states

### User-facing idea

When a team urgently needs a goal, its goalkeeper may join a late corner or suitable attacking free kick as a last throw of the dice.

### Rules and constraints

- The team is trailing.
- Normally 88′ or later, including stoppage time.
- The team wins a corner or suitable attacking free kick.
- The manager’s mentality or match-state logic permits the risk.
- The goalkeeper has not been substituted, dismissed or injured.
- Goalkeepers must not be selected for ordinary outfield events outside this explicit state.

### Technical notes

- Add explicit engine state `goalkeeper_up_for_corner`.
- Add another aerial target while increasing counterattack risk into an exposed goal.
- Allow rare goalkeeper shots, headers, assists and goals.
- Preserve deterministic event generation and commentary.

### Related work

- PR #27 excludes goalkeepers from ordinary outfield commentary.
- Match Engine Constitution and future advanced match-state modules.

---

## FR-002 — Live league table during matches

**Status:** Accepted  
**Likely phase:** Phase 2F — Matchday Experience

### User-facing idea

Show a league table that updates as goals and results change across the current matchday.

### Rules and constraints

- Clearly label the table as live or provisional.
- Revert positions correctly when goals are disallowed or scores change.
- Use the competition’s official ranking and tie-break rules.
- Do not persist provisional standings as final competition state.

### Technical notes

- Derive from the current live score state plus the last completed standings snapshot.
- Reuse the competition standings contract rather than duplicating ranking logic in the browser.
- Support simultaneous fixtures and multiple divisions later.

### Related work

- PR #23 competition standings and results state.
- Phase 2D competition-state infrastructure.

---

## FR-003 — Matchday vidiprinter

**Status:** Accepted  
**Likely phase:** Phase 2F — Matchday Experience

### User-facing idea

Provide a retro teleprinter/vidiprinter showing goals, cards, kick-offs, half-times and full-times from every ground.

### Rules and constraints

- Text-first presentation suitable for desktop, tablet and mobile.
- Events must reflect saved engine output rather than invented browser flavour.
- Allow filtering by division or competition.
- Preserve spoiler settings for the manager’s own fixture where appropriate.

### Technical notes

- Consume a matchday event feed ordered by event time and deterministic sequence.
- Add live score summaries and click-through to each Match Centre.
- Consider Ceefax/Teletext-inspired display modes without compromising accessibility.

### Related work

- PR #24 retro Match Centre.
- PR #25 spoiler-safe replay.
- PR #26 rich deterministic commentary.
- Information, Media & Communication Constitution.

---

## FR-004 — Sweeper-keeper behaviour and positioning

**Status:** Accepted  
**Likely phase:** Phase 2E — Constitutional Match Engine

### User-facing idea

Allow goalkeepers to vary how aggressively they leave their line, sweep behind the defence and support possession.

### Rules and constraints

- Behaviour should depend on goalkeeper attributes, defensive line, opponent threat and manager instructions.
- Aggressive sweeping can prevent through balls but increases lob, error and empty-goal risk.
- It must not turn every goalkeeper into an identical extra defender.

### Technical notes

- Add goalkeeper positioning state and role suitability.
- Integrate with defensive line, pressing, transition and one-on-one resolution.
- Expose outcomes through commentary and goalkeeper match statistics.

### Related work

- Match Engine Constitution.
- Player Rating Constitution.
- FR-005 goalkeeper distribution instructions.

---

## FR-005 — Goalkeeper distribution instructions

**Status:** Accepted  
**Likely phase:** Phase 2E / Phase 3 — Match Engine and Club Tactics

### User-facing idea

Let managers choose goalkeeper distribution such as short, mixed, long, target player or flanks.

### Rules and constraints

- Instructions influence tendencies, not guaranteed actions.
- Availability of passing options and opposition press may override the preferred choice.
- Poor technical suitability should create realistic risk.

### Technical notes

- Add distribution fields to tactical submissions and presets.
- Connect distribution to build-up shape, pressing traps, possession retention and direct attacks.
- Record distribution attempts and success rates where useful.

### Related work

- PR #16 interactive tactics and formation work.
- PR #28 team-sheet presets.
- Match Engine Constitution.

---

## FR-006 — Tactical presets independent of team sheets

**Status:** Accepted  
**Likely phase:** Phase 3 — Club Management / tactical workflow

### User-facing idea

Allow managers to save and load tactical systems without changing the selected players.

### Rules and constraints

- Tactical presets must be separate from complete team-sheet presets.
- Loading one must not silently replace XI, bench or captain.
- Managers may choose whether set-piece instructions are included.

### Technical notes

- Store named tactical payloads with formation and instructions.
- Reuse ownership and RLS patterns from team-sheet presets.
- Provide explicit save, update, load and delete controls.

### Related work

- PR #28 saved team-sheet presets.
- Contracts and Agents Constitution only if staff ownership later affects shared tactics.

---

## FR-007 — Emergency outfield goalkeeper

**Status:** Accepted  
**Likely phase:** Phase 2E — Constitutional Match Engine

### User-facing idea

If a goalkeeper is sent off or injured and no substitute goalkeeper can be used, an outfield player must go in goal.

### Rules and constraints

- Prefer an available substitute goalkeeper when substitutions permit.
- Otherwise select an outfield player through manager instruction or emergency logic.
- Apply severe but role-sensitive goalkeeper penalties.
- Preserve competition substitution rules.

### Technical notes

- Add emergency goalkeeper state and temporary role assignment.
- Recalculate defensive strength, handling, aerial and distribution outcomes.
- Generate appropriate substitutions, commentary and player ratings.

### Related work

- Match Engine Constitution.
- Player Rating Constitution.
- FR-014 suspension handling and FR-015 injuries.

---

## FR-008 — Assistant Manager invalid-team repair

**Status:** Accepted  
**Likely phase:** Phase 2D / Phase 3 — Submission workflow and staff systems

### User-facing idea

If a submitted XI becomes invalid before kickoff, the Assistant Manager repairs it rather than forcing an automatic default team.

### Rules and constraints

- Preserve as much of the manager’s submitted XI, shape and tactics as possible.
- Replace only unavailable or invalid selections.
- Notify the manager exactly what changed and why.
- Apply before final lock and engine preparation.

### Technical notes

- Validate against injuries, suspensions, transfers and registration changes.
- Use deterministic role-aware replacement logic.
- Store amended submission source and audit metadata.

### Related work

- PR #20 fixture locking and AI fallback.
- Manager Career, Participation & Governance Constitution.
- FR-014, FR-015 and FR-016.

---

## FR-009 — Replay timeline and jump-to-minute

**Status:** Accepted  
**Likely phase:** Phase 2F — Matchday Experience

### User-facing idea

Add a replay timeline that lets managers jump directly to a minute or key event.

### Rules and constraints

- Before a result is revealed, seeking must not expose future score or events accidentally.
- After reveal, managers may move freely through the saved match.
- Replay always reads the permanent event stream and never re-simulates.

### Technical notes

- Build indexed event positions by minute and sequence.
- Synchronise scoreboard, commentary window and statistics state after seeking.
- Support keyboard and touch controls.

### Related work

- PR #24 retro replay.
- PR #25 spoiler-safe result reveal.

---

## FR-010 — In-match touchline instructions

**Status:** Accepted  
**Likely phase:** Phase 2E / Phase 2F — Engine and Matchday Experience

### User-facing idea

Allow managers to issue limited tactical instructions while a match is being played.

### Rules and constraints

- Instructions affect future engine states only, never already resolved events.
- Use realistic delays and limits rather than instant total tactical transformation.
- AI-managed clubs require equivalent decision logic.
- Asynchronous worlds need a clear match-window model before this can be enabled.

### Technical notes

- Requires segmented or resumable simulation instead of a single immediate full-match run.
- Persist instruction time, author and resulting tactical state.
- Maintain deterministic replay from the complete instruction/event log.

### Related work

- Match Engine Constitution.
- Manager Career, Participation & Governance Constitution.
- PR #24 Match Centre.

---

## FR-011 — Fixture calendar page

**Status:** Accepted  
**Likely phase:** Phase 2D enhancement / Phase 3

### User-facing idea

Provide a calendar view of upcoming fixtures, deadlines, completed matches and key club dates.

### Rules and constraints

- Show dates in the manager’s selected timezone.
- Distinguish kickoff, submission deadline and processing state.
- Support filters by competition and home/away status.

### Technical notes

- Read from canonical fixtures and competition metadata.
- Avoid creating a second scheduling source of truth.
- Design responsively for tablet use.

### Related work

- PR #20 fixture locking and deadlines.
- World Constitution.

---

## FR-012 — Full fixtures and results browser

**Status:** Accepted  
**Likely phase:** Phase 2D enhancement / Phase 2F

### User-facing idea

Let managers browse every fixture and result by matchday, club, division and competition.

### Rules and constraints

- Respect spoiler-safe result visibility.
- Clearly distinguish scheduled, locked, processing, played and postponed states.
- Link completed fixtures to Match Centre reports.

### Technical notes

- Add paginated/filterable fixture API or database view.
- Reuse canonical club names and competition standings data.
- Support historical seasons later.

### Related work

- PR #22 result persistence.
- PR #23 competition state.
- PR #25 spoiler-safe replay.

---

## FR-013 — Multi-competition fixture support

**Status:** Accepted  
**Likely phase:** Phase 2D enhancement / Phase 4

### User-facing idea

Support league, domestic cup, continental and other competition fixtures within the same manager workflow.

### Rules and constraints

- Each competition may have different tie, extra-time, penalty, registration and substitution rules.
- Scheduling must avoid impossible clashes and respect world cadence.
- Standings logic must not be applied blindly to knockout competitions.

### Technical notes

- Generalise competition format and fixture-stage metadata.
- Add tie/leg identifiers and aggregate-score state.
- Keep the match engine input contract competition-aware.

### Related work

- World Constitution.
- Match Engine Constitution.
- Future Directions Register.

---

## FR-014 — Automatic suspension handling

**Status:** Accepted  
**Likely phase:** Phase 2D enhancement / Phase 2E weekly state

### User-facing idea

Automatically track cards, bans and eligibility so suspended players cannot be selected.

### Rules and constraints

- Suspension rules are competition-specific.
- Managers must receive advance warnings and confirmation when bans begin or expire.
- Previously submitted teams must be revalidated before lock.

### Technical notes

- Persist disciplinary totals and suspension records.
- Integrate with availability, submission validation, AI fallback and weekly processing.
- Preserve an audit trail for overturned or manually corrected discipline.

### Related work

- PR #26 cards and match events.
- Match Engine Constitution.
- Manager Career, Participation & Governance Constitution.

---

## FR-015 — Injury availability integration

**Status:** Accepted  
**Likely phase:** Phase 2E / Phase 3 — Engine, medical and squad management

### User-facing idea

Reflect injuries in squad availability, team selection, inbox messages and recovery timelines.

### Rules and constraints

- Injured players cannot be selected when ruled out.
- Doubtful or partially fit players may remain selectable with explicit risk.
- Injury severity and recovery should be consistent across match and world state.

### Technical notes

- Add injury records, availability status and recovery processing.
- Integrate with fatigue, medical facilities, team validation and AI repair.
- Store match-event provenance for injuries sustained in play.

### Related work

- Match Engine Constitution.
- Scouting & Finance Constitution for facilities implications.
- FR-008 and FR-016.

---

## FR-016 — Improved submission validation and manager warnings

**Status:** Accepted  
**Likely phase:** Phase 2D enhancement

### User-facing idea

Give clear warnings before submission when a team is incomplete, invalid, tactically unsuitable or likely to become invalid.

### Rules and constraints

- Hard errors block submission; advisory warnings may be overridden.
- Never silently change a manager’s team before explaining the reason.
- Validation must use the same rules as fixture locking and engine loading.

### Technical notes

- Centralise validation in a shared server-side contract.
- Return structured error and warning codes for browser presentation.
- Include duplicate players, goalkeeper requirements, registration, availability and deadlines.

### Related work

- PR #19 persistent formation-slot restoration.
- PR #20 fixture locking and fallback.
- FR-008, FR-014 and FR-015.

---

## FR-017 — Matchday administration console

**Status:** Accepted  
**Likely phase:** Phase 2D enhancement / Phase 4 governance

### User-facing idea

Provide authorised administrators with a safe console to inspect and resolve fixture-locking, submission and engine-processing problems.

### Rules and constraints

- Restricted to authorised world administrators.
- Every intervention must be logged.
- Avoid arbitrary result editing except through an explicit governed correction process.
- Normal automated processing remains the default.

### Technical notes

- Show fixture state, both submissions, processing attempts and errors.
- Add guarded retry, reclaim, postpone and correction actions.
- Use service-role operations only in server-side functions.

### Related work

- PR #20 locking and stale-processing recovery.
- PR #21 fixture runner and engine bridge.
- Manager Career, Participation & Governance Constitution.

---

## FR-018 — Pre-match team comparison

**Status:** Accepted  
**Likely phase:** Phase 2F / Phase 3

### User-facing idea

Provide a pre-match comparison of the two clubs without exposing the opponent’s private submitted XI or tactics.

### Rules and constraints

- Never reveal unreleased opponent selections or instructions.
- Use public squad, form, historical and aggregate strength information only.
- Clearly distinguish known facts from forecasts.

### Technical notes

- Derive public comparisons from ratings, recent form, availability and competition state.
- Add head-to-head and tactical-style summaries when those systems exist.
- Keep private submission endpoints isolated from preview data.

### Related work

- PR #24 Match Centre archive security fix.
- Player Rating Constitution.
- Information, Media & Communication Constitution.
