# The Beautiful Game: system trace

_Last updated: 2 August 2026_

This document records how a match travels through the manager portal, match engine, canonical archive, Supabase API and replay UI. It also records the trace of the August 2026 goalkeeper/replay/results/fitness regressions.

## 1. Runtime architecture

### Browser / manager portal

The browser application is deployed to Netlify as `tbg-manager-portal`.

Its responsibilities include:

- manager authentication and club navigation;
- squad, tactics and team-selection views;
- competition tables, fixtures and results;
- spoiler-safe match reports and replays;
- formatting presentation values such as fitness percentages.

The replay and match-centre browser code currently lives primarily in `public/phase2d4.js`.

### Netlify functions

Netlify functions form the authenticated API layer between the browser and Supabase. Important functions include:

- `match-centre`: reads a canonical archived match and decorates player names, substitutions, ratings and summary data for the replay/report UI;
- `run-fixtures`, `run-due-turn-now` and `scheduled-world-turn`: execute scheduled world processing;
- `competition-rounds`: serves competition round/fixture/result data;
- `shared-world`: serves the current canonical world state;
- `reveal-match`: records spoiler-safe match reveals.

### Match engine

The deterministic match engine is under `src/matchEngine`.

Relevant modules include:

- event generation: creates a provisional event stream;
- `modules/PlayerQuality.js`: resolves starters and bench players with their effective quality and football role;
- `LineupResolution.js`: creates position-compatible substitutions, applies cards/injuries/substitutions to the active lineup, and reassigns events whose actors are no longer active;
- later projection/finalisation stages: create the final canonical result and archive payload.

### Supabase

The live TBG Supabase project is `edarvglbzuefveqcjpdt`.

The principal persistent records are:

- `canonical_world_saves`: authoritative current world state;
- `manager_turn_submissions`: submitted team sheets and instructions;
- `world_turn_runs`: central turn-processing runs;
- `canonical_match_archives`: immutable match payloads used by reports and replays;
- `manager_canonical_match_views`: spoiler/reveal ledger;
- `competition_standings`: persisted standings where applicable;
- operational event, alert and backup tables.

`canonical_match_archives.archive_payload` contains four top-level sections:

- `fixture`;
- `result`;
- `players`;
- `club_profiles`.

The replay is not re-simulated. It presents the event stream already stored in `archive_payload.result.events`.

## 2. Match lifecycle

1. A manager submits a lineup and tactics.
2. The canonical turn runner locks the due fixtures.
3. Player quality and role metadata are resolved for both starting XIs and benches.
4. The engine creates provisional match events.
5. `LineupResolution.js` adds substitutions and applies the active-player timeline.
6. The final result, teams, events, statistics and lineup state are written to `canonical_match_archives`.
7. The manager opens a result or replay.
8. The `match-centre` Netlify function authenticates the manager, reads the archive, decorates IDs with canonical player names and returns a display payload.
9. `public/phase2d4.js` renders the report, lineups and timed replay.

A crucial debugging rule follows from this lifecycle:

> If an incorrect actor is already present in `canonical_match_archives.archive_payload.result.events`, the replay UI is displaying stored engine output rather than inventing the error.

## 3. Goalkeeper trace: confirmed findings

The affected Real Madrid archives were created at approximately 11:00 UTC on 2 August 2026. The position-safe substitution fix was deployed later, at approximately 18:16 UTC. These archives therefore pre-date the fix.

The stored canonical events confirm that the bad goalkeeper actions are in Supabase itself:

### Matchday 2

- 88': `foul`, actor `tbg-tm-00108390` — Thibaut Courtois.

### Matchday 3

- 60': substitution: Arda Güler (`tbg-tm-00861410`) off, Thibaut Courtois (`tbg-tm-00108390`) on;
- 78': yellow card, actor `tbg-tm-00404839` — Andriy Lunin;
- 85': foul, actor Andriy Lunin;
- 86': big chance, actor Andriy Lunin.

The archive's `players` map correctly identifies Courtois and Lunin as `position: Goalkeeper`. Their archived player rows do not contain an `actual_role` property.

### What the deployed fix now does

Current `LineupResolution.js`:

- maps roles into goalkeeping, defence, midfield and attack units;
- permits a goalkeeper replacement only for a goalkeeper slot;
- rejects a goalkeeper as a replacement for every outfield role;
- excludes starting goalkeepers from tactical substitution candidates.

This should prevent newly generated Courtois-for-Güler substitutions when role metadata reaches lineup resolution correctly.

### Remaining engine risk

The substitution fix does not by itself prevent a goalkeeper being selected as the original actor of a foul, card, shot or big chance. The stored Lunin events demonstrate a separate event-actor eligibility problem in the pre-fix archives.

The next engine safeguard should therefore validate every event actor by event type and active role before finalisation. Suggested rules:

- goalkeepers may be selected for saves, claims, distribution, goalkeeper errors, goalkeeper fouls/cards and rare explicitly supported set-piece scenarios;
- normal shots, big chances and attacking actions should select eligible outfield players;
- generic fouls/cards may include the active goalkeeper only in goalkeeper-context events, rather than through an unrestricted whole-lineup draw;
- final archive validation should reject or deterministically reassign impossible actor/event combinations.

Regression tests must cover both substitution compatibility and event-actor eligibility.

## 4. Archive projection trace

`netlify/functions/match-centre.mjs` does not choose football actions. It:

- normalises event type names;
- resolves primary, assisting, incoming and outgoing player IDs;
- replaces generic `A player...` commentary with the resolved canonical name;
- derives performance summaries and lineup timelines;
- returns the stored event stream to the browser.

Therefore changing only `match-centre.mjs` would cosmetically hide the goalkeeper bug but would not repair canonical simulation output.

Old archives will continue to replay their historical bad events unless they are regenerated or explicitly repaired. Any repair should preserve auditability and must not silently rewrite competitive results.

## 5. Goal replay trace

Goals reach the match-centre response with normalised types `goal` or `penalty_scored`, and the API also builds scorer summaries from those types. The missing dramatic beat is therefore downstream in replay playback/rendering rather than in Supabase scoring data.

Trace next in `public/phase2d4.js`:

- event scheduling/timer advancement;
- the branch that recognises `goal` and `penalty_scored`;
- pause duration at 1x and accelerated speeds;
- highlighted-event CSS class and focus/scroll behaviour.

Acceptance rule: every normal or penalty goal should create a visibly highlighted beat and a longer playback pause without requiring the user to pause manually.

## 6. Competition results / HTTP 502 trace

The standings table is rendering from available world/competition data, while the results panel is showing a raw upstream failure string. This indicates two separate request paths.

Trace next:

1. browser request issued by the competition view;
2. `competition-rounds` Netlify function;
3. Supabase/world-save path used to derive the selected division and round;
4. response parsing when Netlify receives an empty or non-JSON upstream body.

The UI must never print transport text such as `HTTP 502; empty response body`. It should show a friendly empty/error state and retain standings already loaded successfully.

## 7. Fitness formatting trace

Fitness is a numeric gameplay value and should remain precise in canonical state. Rounding belongs only in presentation.

Display contract:

```js
`${Math.round(Number(fitness))}%`
```

This helper should be shared across squad, team selection, substitutions and any player-card views. Do not round the persisted value or the value used by the match engine.

## 8. Debugging checklist

When a replay looks wrong:

1. identify the fixture ID;
2. inspect `canonical_match_archives.archive_payload.result.events`;
3. inspect the matching player rows in `archive_payload.players`;
4. compare archive creation time with the relevant deployment time;
5. determine whether the error is stored engine output or display projection;
6. add a fixture-shaped regression test before changing production logic;
7. verify a newly generated match, because old immutable archives do not prove that a new fix failed.

## 9. Immediate work items

- Add event-type/role eligibility validation before canonical archive creation.
- Add tests proving goalkeepers cannot receive ordinary big chances or replace outfield players.
- Restore the goal-highlight playback branch.
- trace and repair the `competition-rounds` 502 path with graceful UI degradation.
- centralise whole-number fitness formatting.
- decide whether the three pre-fix Real Madrid archives should remain as historical test artefacts or be regenerated during the current development season.
