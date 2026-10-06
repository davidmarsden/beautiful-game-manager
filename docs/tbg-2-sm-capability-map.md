# TBG 2 — Soccer Manager → TBG Capability Map

**Status:** Product-definition artefact  
**Parent:** #457 — TBG 2 Product Definition & Replacement Game  
**North star:** **Alpha 1 proved feasibility. TBG 2 must prove preference.**

This map turns Soccer Manager from an implicit reference point into an explicit product baseline. It is not a specification to clone Soccer Manager screen-for-screen. It asks, for every capability that matters to experienced Top 100 managers:

1. what behaviour they already understand and depend on;
2. what Top 100 Sync can actually preserve/import from the existing world;
3. what Alpha 1 already proved technically or conceptually;
4. what TBG 2 should **match**, **improve**, **replace**, **retain from TBG**, or **defer**;
5. what belongs in the first preference-testing vertical slice.

The principle is simple:

> **Soccer Manager is the behavioural floor, not the design ceiling.**

And the migration promise is stronger:

> **Here is the Top 100 world you know. Now manage it somewhere better.**

---

## 1. Evidence now available

This map is grounded in three unusually useful bodies of evidence.

### 1.1 Top 100 Sync — observed Soccer Manager data

Manager Lab has already identified working read-only collection surfaces for:

- world / competition structure;
- divisions and standings;
- current manager assignments;
- fixtures and results;
- season/champion history and player leaderboards;
- squads and player state;
- transfers;
- player/rating/position changes;
- club finance capture;
- tactics and selected-player tactical state;
- match reports;
- match replay/event streams.

The stable identity graph is particularly important: `setupID` for the world, world/global club identifiers, persistent manager/customer IDs, `playerDataId` across player surfaces, and fixture IDs into reports/replays.

This means TBG 2 does not need to begin with an empty fictional world. A Top 100 import can potentially reconstruct a recognisable football world from stable identities and preserved history.

### 1.2 Alpha 1 — proof and failure evidence

Alpha 1 proved that TBG can operate a persistent multiplayer football world with its own match engine, ratings, transfers, contracts/finance foundations, manager authentication, history, governance and community surfaces.

It also showed that technical breadth is not the same as product preference. Experienced managers encountered too much friction in the everyday loop: login/onboarding defects, slowness, sparse interaction, an underpowered player/market experience, unfamiliar or incomplete squad/tactics workflows and repeated bugs. Building more peripheral depth on top of that would not solve the core problem.

### 1.3 Top 100 itself — the actual target community

TBG 2 is no longer trying to prove that strangers can be recruited into a new football game. Its first concrete use case is much sharper: **could the existing Top 100 world move?**

That changes the design priority. The first release does not need to beat every Soccer Manager feature. It needs to make the things Top 100 managers repeatedly do feel immediately recognisable, fast and better.

---

## 2. Decision vocabulary

Each capability gets one primary treatment:

| Treatment | Meaning |
|---|---|
| **MATCH** | Preserve the familiar behaviour closely enough that an SM manager needs little or no explanation. |
| **IMPROVE** | Preserve the mental model but make it faster, clearer, richer or less frustrating. |
| **REPLACE** | SM behaviour is not worth reproducing; use a better TBG model. |
| **RETAIN** | A TBG-native capability is already strategically better and should survive the rebuild. |
| **DEFER** | Valuable, but not allowed to delay proving the core loop. |

Priority:

- **P0** — required for the first vertical slice / preference test;
- **P1** — required for a credible Top 100 replacement beta;
- **P2** — expansion after preference is demonstrated.

Each row has exactly one priority. Where a capability contains later depth, the row is prioritised at the earliest stage needed and the treatment text identifies what remains deferred.

---

## 3. Core capability map

| Domain | Soccer Manager behavioural floor | Sync/import evidence | Alpha 1 / TBG asset | TBG 2 treatment | Priority |
|---|---|---|---|---|---|
| **World identity** | A manager enters a specific persistent game world and immediately recognises its clubs, divisions and current season | `setupID`, divisions, standings, clubs, seasons | Persistent canonical world | **IMPROVE** — import Top 100 itself rather than ask managers to learn a replacement world | **P0** |
| **Manager identity & club tenure** | Persistent manager identity attached to a club in a world | stable manager/customer IDs and world assignments | Auth, appointments, governance | **IMPROVE** — stable career identity, explicit tenure history, no fragile name matching | **P0** |
| **Home / dashboard** | Fast orientation: club, next match, table/position, recent activity and obvious actions | standings, fixtures, transfers, squad state | Alpha dashboard/inbox/feed foundations | **IMPROVE** — a genuinely useful home screen, not a portal menu | **P0** |
| **Squad list** | Dense, scannable roster with rating, age, position, value and status | authoritative squad scope + rating, age, value, contract, appearances, morale, fitness etc. | Alpha squad views; TBG ratings | **IMPROVE** — SM familiarity with much better sorting/filtering, depth/status cues and speed | **P0** |
| **Player profile** | One place to understand who a player is and whether you want/use him | stable player identity, rating, age, value, contract, performance, changes, transfer history | Rating constitution, contracts, history | **IMPROVE heavily** — this is a flagship TBG 2 surface, with richer longitudinal and football context | **P0** |
| **Player search/database** | Search the football universe quickly by useful recruitment criteria | player identities from squads/transfers/changes; TM/TBG source universe extends beyond Sync | Alpha global search; Transfermarkt/rating pipeline | **IMPROVE heavily** — fast global database, filters, comparisons and direct actions | **P0** |
| **Transfer market** | Find available players, bid, negotiate and track deals with familiar state transitions | transfer records expose player, clubs/managers, values, amount, status and offers where exposed | Alpha transfer lifecycle and atomic settlement foundations | **IMPROVE** — preserve familiar actions/states, remove latency/confusion, make market much easier to browse | **P0** |
| **Free agents / external market** | Recruit outside current managed squads subject to game rules | player universe and external club counterparties are already distinguishable | Alpha external/free-agent acquisition | **IMPROVE** — P0 supports the coherent recruitment path needed for the preference test; richer external-market rules can follow | **P0** |
| **Shortlist / scouting notebook** | Save targets for later | Sync not required | Alpha private shortlist/notes | **RETAIN + IMPROVE** — instant shortlist, comparisons, alerts/history later | **P0** |
| **Formation / XI selection** | Visual, familiar selection of formation, starters and substitutes | tactics response exposes formation and selected-player state | Alpha engine-aware team submission/autopick | **IMPROVE heavily** — touch-first, fast, obvious eligibility/fitness/role information | **P0** |
| **Team tactics** | Familiar instruction set managers can change before matches | tactics capture includes aggression, style, focus, tempo, pressing, counter, marking, offside, width, fluidity, creativity, lines and specialist roles | Constitutional match engine + tactics model | **MATCH mental model / IMPROVE interaction** — translate cleanly into TBG engine semantics, avoid mystery switches | **P0** |
| **Match submission** | Manager knows the team/tactics are saved for the correct fixture | tactics + fixture identity | Alpha private submissions, deadlines, deterministic fallback | **IMPROVE** — explicit saved/submitted state, autosave where safe, zero ambiguity | **P0** |
| **Fixture list / schedule** | Quickly see past and upcoming matches | fixtures/results importable | Alpha schedule/history | **MATCH + IMPROVE** — immediate and lightweight | **P0** |
| **Match result / report** | Score, lineups, events, stats and player performance after the match | match-report JSON working | Alpha match centre/replay/history | **IMPROVE** — fast result first, progressive detail underneath | **P0** |
| **Live/replay experience** | Follow or revisit match events | replay XML/event stream working when exposed | TBG match engine can produce native event history | **REPLACE eventually** — TBG owns the simulation, so build a better native match narrative/replay | **P1** |
| **League table** | Instant understanding of position, games and points | standings importable and snapshot-able | Alpha competition tables | **MATCH + IMPROVE** — should feel instantaneous and obvious | **P0** |
| **Competition history** | Season/champion records exist but SM history is limited/ephemeral | season/champion history importable | Persistent TBG history | **IMPROVE decisively** — never throw history away | **P1** |
| **Cups / SMFA competitions** | Multiple competition types coexist with league play | fixture/report traversal exists; coverage still needs mapping | Match engine/world constitution | **MATCH initially**, richer TBG model later | **P1** |
| **Promotion/relegation/playoffs** | World progression managers already understand | standings/history help reconstruct outcomes | World Constitution has governed model | **RETAIN rules where chosen**, but specify against imported Top 100 structure rather than Alpha implementation | **P1** |
| **Player ratings** | Simple headline rating is central to SM squad/market decisions | current/historical rating changes captured | TBG transparent rating constitution + TM data | **RETAIN + IMPROVE** — recognisable headline rating, better provenance/explanation | **P0** |
| **Positions / versatility** | Position labels determine usable roles | positions and changes captured | Engine-aligned positional versatility | **RETAIN + IMPROVE** | **P0** |
| **Player value** | Market value is a major scanning cue | values captured across player/transfer surfaces | TBG finance/valuation work | **MATCH cue / REPLACE formula as needed** — keep understandable number, own the model | **P0** |
| **Contracts & wages** | Contract/wage information affects squad decisions | squad capture exposes contract/wage state where available | Contracts & Agents Constitution; Alpha expected-wage model | **IMPROVE**, but keep v1 interaction simple | **P1** |
| **Morale / condition / injury / suspension** | Immediate selection constraints/status | captured in squad/tactics state | Match engine fitness/state foundations | **MATCH visibility + IMPROVE explanation** | **P0** |
| **Finance** | Club budget constrains recruitment | finance surface captured; historical model not yet persisted | Alpha cash/wage economy | **MATCH essentials** — P0 provides the credible budget constraint needed for transfers; richer finance simulation is deferred | **P0** |
| **Youth** | SM has player development/youth concepts but not TBG's governed discovery model | squad can distinguish youth; player changes expose new players | Youth Discovery Constitution | **RETAIN TBG model**, introduce after core preference proof | **P2** |
| **Scouting uncertainty** | SM largely presents a known player database | Sync preserves source truth, not a scouting model | Scouting/Finance Constitution | **REPLACE with TBG depth later** | **P2** |
| **News / world activity** | World feels alive through transfers/results/activity | imported transfers/results/changes provide event sources | World Feed/media foundations | **IMPROVE**, but not before core UI speed | **P1** |
| **Chat / community** | SM interaction exists but Top 100 community already lives beyond the game | Sync not required | Top 100 Chat + TBG communication constitution | **RETAIN / integrate deliberately** — community is an advantage, not a reason to rebuild another chat app | **P1** |
| **Manager records / careers** | Manager identity persists but SM historical access is limited | stable IDs support cross-world tenure/history; chronology still needs modelling | Manager career/governance constitution | **IMPROVE decisively** — P1 establishes durable records/tenures; richer reputation and career simulation remains later depth | **P1** |
| **Governance / sackings / vacancies** | SM supplies world administration rules; Top 100 overlays its own culture/rules | assignments/status imported | TBG governance constitution; Top 100 governance experience | **RETAIN TBG/Top 100 governance**, not SM quirks | **P1** |
| **Historical archive** | Much useful SM data disappears or becomes hard to retrieve | Sync is already preserving snapshots, transfers, changes, tactics, reports | TBG persistent canonical history | **RETAIN + make first-class** | **P1** |
| **Analytics / opponent intelligence** | SM gives the raw game, not longitudinal analysis | Sync archive already powers dossiers, tactical stability, XI gaps, Red Card Lab, Run-in Lab | Manager Lab | **IMPROVE beyond SM** — P1 establishes useful opponent intelligence; deeper analytical tooling can expand later | **P1** |
| **Mobile/tablet usability** | Existing managers know SM mobile interaction, even where clumsy | n/a | Alpha exposed serious mobile friction | **IMPROVE decisively** — touch-first is a release criterion, not polish | **P0** |
| **Performance / responsiveness** | Managers expect ordinary actions to feel immediate | n/a | Alpha slowness was a retention problem | **IMPROVE decisively** — budget latency explicitly | **P0** |
| **Reliability / recovery** | Users should not have to understand application internals | n/a | Alpha proved checksum/CAS, recovery, audit and backup patterns | **RETAIN foundations, hide complexity** | **P0** |

---

## 4. The P0 preference-test loop

The first TBG 2 vertical slice should remain brutally narrow:

> **Home → Squad → Player → Transfers → Team & Tactics → Match → Table**

This is not merely a navigation list. It is the minimum coherent management story.

### Home

A returning Top 100 manager should know within seconds:

- which club/world they are managing;
- league position and immediate context;
- next opponent and deadline;
- urgent squad/transfer decisions;
- what changed since the last visit.

No dashboard widget exists merely because data exists.

### Squad

The squad must be dense enough for an experienced manager and legible enough on a tablet. Default information should answer: **who do I have, how good are they, where can they play, are they available, how are they doing, and what needs attention?**

Fast sort/filter/search matters more than decorative cards.

### Player

The Player profile is the first obvious opportunity to beat SM rather than copy it. It should combine:

- identity and imagery where legally/operationally viable;
- rating and position/versatility;
- age, value, wage/contract essentials;
- condition/morale/availability;
- season and recent performance;
- rating/change history;
- transfer history;
- squad role/context;
- shortlist/recruitment actions;
- later: comparison, scouting knowledge and longitudinal analytics.

### Transfers

A manager should be able to move from “I need a player” to useful candidates quickly, understand whether/how a player can be acquired, make an offer and understand its state without reading a rulebook.

The Alpha mistake to avoid is making the transaction engine more sophisticated than the recruitment experience.

### Team & Tactics

This should feel recognisable on first contact. Formation, XI, bench and instructions must be manipulable quickly by touch. TBG can own richer semantics underneath, but the manager should not have to translate an engine constitution in their head to pick a team.

### Match

Result first. Then the story of why/how: lineups, events, stats, performance, tactical consequences and eventually a richer TBG-native replay/narrative.

### Table

Instant, familiar, boring in the best possible sense. This is not where TBG proves originality.

---

## 5. What Sync changes about the rebuild

Before Sync, “replace Soccer Manager” implied recreating a world by hand and asking managers to abandon accumulated context.

That is no longer the obvious route.

The current Sync identity/data map means the **Top 100 Import Specification** can be designed around real source entities:

```text
setupID
  -> world
  -> divisions / seasons
  -> world club instances
  -> manager assignments / tenures
  -> squad scopes
      -> playerDataId
      -> player snapshots
  -> fixtures/results
      -> reports
      -> replay/events
  -> transfers
  -> player changes
  -> tactics snapshots
  -> finance snapshots
```

The crucial architectural principle from Sync should survive into TBG 2:

> **Source truth, canonical game state and presentation are different things.**

Sync already uses stage → review/approve → explicit archive adapters rather than allowing a browser scrape to mutate history directly. A migration/import path should preserve that caution.

Stable IDs should be preferred over display names. Ambiguity should stop an import rather than guess.

---

## 6. What we should not copy from Soccer Manager

A replacement game is pointless if it faithfully reproduces the frustrations that caused the project to exist.

Do **not** copy:

- slow or opaque page transitions;
- inconsistent saved/submitted state;
- history that disappears or becomes inaccessible;
- thin player profiles when we possess richer longitudinal data;
- recruitment flows that make discovery harder than necessary;
- arbitrary separation of information managers naturally need together;
- mobile interactions that merely shrink desktop UI;
- unexplained formulas or status changes where TBG can be transparent;
- community/admin friction that Top 100 already solves better outside SM;
- dependence on a third-party platform as the only durable record of the world.

Familiarity is about **mental models and task flow**, not preserving every inconvenience.

---

## 7. TBG assets that survive the reset

The rebuild should not throw away the parts that are already more ambitious than SM:

- constitutional match engine and its calibration work;
- transparent player-rating model and Transfermarkt-backed data pipeline;
- persistent/auditable world history;
- contracts/agents design work;
- youth discovery model;
- scouting/finance model;
- manager career/participation/governance model;
- information/media/communication model;
- robust transaction/recovery/audit patterns learned in Alpha;
- Top 100 Chat/community infrastructure;
- Manager Lab longitudinal data and experiments.

But these are **assets, not permission to expand scope**. P2 depth waits until the P0 loop proves preference.

---

## 8. First measurable product budgets

TBG 2 should turn Alpha lessons into explicit acceptance criteria.

For the first preference-test build:

- a returning authenticated manager reaches useful Home content without an explanatory interstitial;
- primary P0 views should feel immediate after initial load; avoid blocking whole pages on slow secondary data;
- Squad sorting/filtering and formation/XI interaction must respond locally without network-round-trip-feeling interaction;
- every mutating action exposes an unambiguous pending/saved/submitted/result state;
- the core loop must work comfortably on phone and tablet as well as desktop;
- empty/error/loading states must tell the manager what is happening and preserve useful already-loaded content;
- a manager should never need an admin to repair ordinary progression through the preference-test loop.

Precise performance thresholds belong in the architecture/prototype work once the stack is measured; the important decision here is that responsiveness is a **product requirement**, not later optimisation.

---

## 9. Preference-test scenario

Give an experienced Top 100 manager an imported version of their recognisable club with no walkthrough.

Ask them to:

1. identify their league position and next opponent;
2. inspect their squad and identify one weakness;
3. open two player profiles and compare them;
4. find a plausible recruitment target and shortlist or bid for them;
5. choose a formation, XI and substitutes;
6. alter at least two tactical instructions;
7. confirm the team is submitted;
8. inspect a completed match and understand the main story;
9. return to the league table.

Measure:

- completion without help;
- time per task;
- errors/backtracking;
- perceived responsiveness;
- points where the manager expects SM behaviour and TBG surprises them;
- which surprises are improvements versus confusion;
- direct answer to: **which would you rather use for Top 100?**

The success bar remains:

> Within ten minutes, the manager should encounter at least one thing that makes them think: **“I wish Soccer Manager did it this well.”**

---

## 10. Open questions for the Top 100 Import Specification

The capability map exposes the next concrete questions rather than answering them prematurely:

1. What is the authoritative import boundary: a one-time cutover snapshot, historical reconstruction, or both?
2. Which current Top 100 state must be exact at cutover: clubs, managers, squads, ratings, values, cash, contracts, tactics, fixtures, table, transfers?
3. Which historical data can Sync reconstruct reliably enough to become canonical TBG history?
4. How should Soccer Manager ratings/values/contracts map onto TBG's own governed models at migration time?
5. Do we import current tactics as a familiar starting state, translate them into TBG semantics, or ask managers to submit afresh?
6. How do we represent external clubs and players outside the 100-club world?
7. How much cup/SMFA history can fixture/report traversal recover?
8. What manager tenure chronology is known versus inferred?
9. What finance state is trustworthy enough to migrate, given finance chronology is not yet archived?
10. What licensing/asset path is acceptable for crests and player imagery?
11. What is the freeze/cutover protocol if Top 100 ever genuinely moves from SM?
12. Can the same importer be repeatable enough to rehearse migration long before any real cutover?

---

## 11. Next decision

With this capability map in place, the next artefact is the **Top 100 Import Specification**.

That specification should define:

- source entities and stable IDs;
- required current-state fidelity;
- historical migration tiers;
- transformations into TBG-native models;
- validation/reconciliation reports;
- repeatable rehearsal imports;
- ambiguity/failure policy;
- eventual cutover/freeze procedure.

Only after the import contract is understood should we make the explicit architecture decision about which Alpha code is kept, extracted, rewritten or retired.