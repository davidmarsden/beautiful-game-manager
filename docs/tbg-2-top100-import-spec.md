# TBG 2 — Top 100 Import Specification

**Status:** product/data contract before implementation  
**Parent:** #457 — TBG 2 Product Definition & Replacement Game  
**Depends on:** TBG 2 Product Brief; Soccer Manager → TBG Capability Map  
**North star:** **Import the world managers recognise without pretending uncertain history is fact.**

This specification defines how a Soccer Manager Top 100 world can be reconstructed as input to TBG 2. It covers current-state fidelity, historical migration tiers, transformations from Soccer Manager source truth into TBG-native game state, repeatable rehearsal imports, reconciliation and ambiguity policy, and an eventual live freeze/cutover procedure.

It is deliberately an **import contract, not an architecture decision**. It says what a trustworthy importer must do before deciding exactly which Alpha code or application architecture implements it.

---

## 1. Import principles

### 1.1 Source truth is not TBG truth

Soccer Manager Sync observes what Soccer Manager exposes. TBG 2 owns what the new game means after migration. Preserve the source record and provenance separately from transformed TBG state.

```text
SM source observation
    -> normalised source entity
    -> staged import candidate
    -> validation / reconciliation
    -> explicit transformation
    -> TBG canonical state
```

Never let a browser capture write directly into playable TBG state.

### 1.2 Stable identity before names

Prefer known stable source identifiers:

- `setupID` — source game world;
- manager/customer ID — source manager identity;
- world-specific club ID plus global club-data ID where available;
- `playerDataId` — preferred cross-surface player identity;
- world-specific `playerId` retained as source context;
- fixture ID — fixture/report/replay spine;
- transfer/event/change IDs plus occurrence metadata.

Names are presentation and cautious bootstrap evidence. A matching name is not sufficient evidence to merge identities.

### 1.3 Exact where continuity requires it

A manager entering imported Top 100 should recognise the world immediately. Current clubs, manager assignments, squads, competition state and playable schedule are continuity-critical.

### 1.4 Transform explicitly where TBG owns the model

TBG does not have to inherit every Soccer Manager formula. Ratings, valuation, contracts, tactics and finance may need translation into TBG-native rules. Such translation must be deterministic, documented and reconcilable.

### 1.5 Unknown is better than invented

Missing history remains missing. Inferred history is labelled inferred. Ambiguous identity blocks the affected record rather than choosing the most plausible name.

### 1.6 Rehearse before cutover

A real migration should be boring. The same import should be run repeatedly against disposable TBG worlds long before any decision to leave Soccer Manager.

---

## 2. Known source surfaces

Top 100 Sync currently has working read-only collection for the following Soccer Manager surfaces.

| Surface | Key source identity | Current evidence | Import role |
|---|---|---|---|
| World / competition | `setupID`, league/season/club/manager IDs, `fixID` | world, divisions, standings, assignments, fixtures/results, season/champion history, player leaders | world skeleton and competition state |
| Squad | `sid`, club ID, `playerDataId`, world `playerId` | authoritative squad scope; identity, rating, age, value, contract, performance/current state | current roster baseline |
| Transfers | transfer ID, `PlayerDataID`, club IDs, manager IDs, turn | parties, value/amount, status, date, player offers where exposed | current/past market history |
| Player changes | player/change/event IDs, `PlayerDataID`, date/turn | rating/position changes, new players, old/new values | longitudinal player history |
| Club finance | world/club context, season/turn where exposed | current/season finance state | current finance baseline; chronology incomplete |
| Tactics | club/world context, turn date, player IDs, formation ID | formation, instructions, specialists, selected-player state | optional current familiar starting state; historical tactical analysis |
| Match report | fixture ID | score, stats, players and exposed match events/data | historical match record |
| Match replay | fixture/match/event/player/team IDs | chronological event/replay state | richer history where exposed |

Known limitations remain important: finance does not yet have a dedicated historical archive adapter; manager tenure chronology is not yet explicit; player identity should still be verified across worlds/lifecycles; competition coverage for recursive historical match traversal needs measurement; replay XML is not guaranteed for every match.

---

## 3. Import modes

The importer must support three modes using the same contracts.

### 3.1 Rehearsal

Creates or replaces a disposable, non-authoritative TBG import world from a declared source snapshot. Used throughout development and preference testing.

Requirements:

- repeatable;
- safe to destroy/recreate;
- never affects a live world;
- emits complete reconciliation reports;
- records source snapshot/version and transformation version.

### 3.2 Refresh

Updates a rehearsal candidate from a newer SM snapshot while SM remains authoritative. Used to test drift, changed mappings and cutover readiness.

Refresh must distinguish:

- unchanged source entities;
- legitimate source changes;
- newly discovered historical records;
- transformation-version changes;
- unexpected regressions or identity conflicts.

### 3.3 Cutover

Creates the authoritative TBG world from a declared final SM boundary. Cutover is irreversible from TBG's perspective except by abandoning that candidate and starting again from source. It must not be an ad-hoc refresh with a different label.

---

## 4. Current-state fidelity contract

Fidelity classes:

- **EXACT** — imported state must agree with the final accepted source snapshot before cutover can pass.
- **TRANSFORMED** — source state must be fully accounted for, but TBG deliberately computes a different canonical value using a versioned rule.
- **OPTIONAL** — may be imported where trustworthy but does not block first playable migration.
- **TBG-NATIVE** — do not import as governing state; initialise according to TBG rules.

| Domain | Class | Cutover requirement |
|---|---|---|
| World identity | EXACT | one declared source `setupID` maps to one migration candidate/world |
| Competition/division membership | EXACT | every in-scope Top 100 club belongs to the correct division/competition |
| Current season/turn | EXACT | source boundary recorded and mapped to TBG starting boundary |
| Current standings | EXACT | rank, played, wins/draws/losses, goals and points agree where source exposes them |
| Current manager ↔ club assignments | EXACT | every managed club maps to the correct stable manager identity; vacancies preserved |
| Current squad membership | EXACT | authoritative squad scope reconciles every in-scope club; no silent stale memberships |
| Player source identity | EXACT | every imported player has traceable source identity; no ambiguous merges |
| Player name/age/nationality | EXACT source copy where exposed | differences only through explicit data-authority decision |
| SM headline rating | EXACT as source evidence | retain source rating for provenance/comparison even if TBG rating differs |
| TBG headline rating | TRANSFORMED | generated by declared TBG rating dataset/formula/version; mapping report required |
| Positions | TRANSFORMED where models differ | source positions retained; deterministic TBG role/position mapping |
| SM player value | EXACT as source evidence | preserve for migration/reconciliation |
| TBG player value | TRANSFORMED | computed under TBG valuation model once chosen |
| Contract/wage state | TRANSFORMED | source fields accounted for; TBG contract model initialisation explicitly versioned |
| Fitness/morale/injury/suspension | EXACT where required for immediate continuity | otherwise initialise only under an approved boundary rule; never silently randomise |
| Club cash/current finance | EXACT if accepted as trustworthy cutover source | otherwise cutover cannot claim finance continuity; use declared TBG initialisation rule |
| Historical finance | OPTIONAL | never reconstructed from current balance alone |
| Future fixtures | EXACT schedule identity/opponents where Top 100 continuity requires it | fixture dates/rounds mapped explicitly into TBG schedule |
| Played fixtures/results in current season | EXACT | results and competition consequences reconcile |
| Current tactics | OPTIONAL / TRANSFORMED | may seed familiar formation/instructions through a declared mapping; managers may be asked to resubmit |
| Pending SM transfer negotiations | OPTIONAL by default | do not invent equivalent transactional state; either map explicitly or close at freeze boundary |
| Governance/admin state | TBG-NATIVE | initialise under TBG/Top 100 governance rules, not undocumented SM internals |
| Match-engine hidden state | TBG-NATIVE | never attempt to reproduce inaccessible SM simulation state |

### 4.1 Non-negotiable current-state gate

A cutover candidate cannot pass while any of these are unresolved:

- unknown/duplicate club identity;
- ambiguous manager assignment for a managed club;
- unreconciled current squad membership;
- duplicate/ambiguous player identity within the playable world;
- disagreement in current competition membership/table/result state that changes sporting reality;
- unexplained missing future league fixture required to continue the season;
- unclassified finance handling if finance is enabled at launch.

---

## 5. Historical migration tiers

History is migrated by confidence tier, not by desire.

### H0 — current playable state

Required. This is section 4: enough exact/transformed state to begin managing the recognisable Top 100 world.

### H1 — source-backed canonical history

Import as canonical historical fact when stable identity and occurrence evidence are sufficient:

- captured fixtures/results;
- match reports;
- replay/events where available;
- transfers with stable transfer/player/club identity;
- player rating/position changes with occurrence discriminator;
- season/champion records exposed by the competition source;
- immutable squad snapshots with known capture time;
- tactics snapshots as observations at known times.

Every H1 record keeps provenance to the source surface and capture/occurrence metadata.

### H2 — corroborated reconstructed history

History assembled from multiple trustworthy source observations where no single source record is complete. Examples might include manager tenure bounds derived from successive authoritative assignment snapshots, or competition history assembled from fixture/report traversal plus season records.

H2 requires:

- explicit reconstruction rule/version;
- supporting source references;
- confidence/reconstruction marker;
- no presentation as directly observed source fact.

### H3 — community/archive history

Potential future import from Top 100's own historical records, posts, spreadsheets or other archives. H3 is outside the initial Sync contract and must never be silently merged with H1. It requires its own provenance and reconciliation rules.

### H4 — unknown / unavailable

Leave blank. A gap is legitimate data.

No migration code may convert H4 into a guessed event simply to make a timeline look complete.

---

## 6. SM → TBG transformation registry

Every transformed field must have a named/versioned rule. The registry begins conceptually as follows.

| Area | Source retained? | TBG canonical decision |
|---|---|---|
| World/club/manager/player identity | Yes | create TBG IDs linked permanently to source IDs; never make SM IDs the only internal key |
| Ratings | Yes | preserve SM rating snapshot; compute TBG rating from TBG data/rating pipeline at declared dataset/formula version |
| Positions | Yes | preserve source labels; map to TBG engine positions/roles with versioned lookup/rule |
| Values | Yes | preserve SM value; compute TBG value when valuation model is approved |
| Contracts/wages | Yes | preserve exposed source state; initialise TBG contract under an explicit migration rule rather than pretending models are equivalent |
| Fitness/current availability | Yes | map compatible state where trustworthy; otherwise apply a single declared boundary initialisation rule |
| Tactics | Yes | preserve raw/normalised SM tactic observation; translate only instructions with defined TBG semantics; unmapped instructions must be reported |
| Finance | Yes | preserve source finance snapshot; choose exact balance migration or explicit TBG initialisation before finance-enabled cutover |
| Competition state | Yes | preserve source standings/results; initialise TBG competition from reconciled sporting state |
| Historical events | Yes | TBG historical records link back to source provenance and migration tier |

### 6.1 No semantic laundering

A source field with the same English label as a TBG field is not automatically equivalent. `rating`, `value`, `wage`, `morale`, `fitness`, tactical labels and contract durations all require semantic confirmation before direct mapping.

### 6.2 Transformation manifest

Every rehearsal/cutover records a manifest containing at least:

```text
import_run_id
mode
source_world_setup_id
source_snapshot_id / capture boundary
source_capture timestamps
importer version/commit
transformation registry version
TBG rating dataset + formula version
TBG valuation version (when applicable)
TBG contract migration version (when applicable)
TBG tactics mapping version (when applicable)
created_at
status
```

This makes a migrated world reproducible enough to explain later.

---

## 7. Import phases and dependency order

A candidate import should be built in dependency order rather than page order.

1. **Source snapshot lock** — declare which approved Sync source records constitute this run.
2. **Identity registry** — world, competition, club, manager and player source identities.
3. **World skeleton** — divisions/competitions, clubs, season/turn boundary.
4. **Manager assignments** — managers, vacancies and club tenures at the boundary.
5. **Players and authoritative squad scopes** — identities first, then current membership/state.
6. **Competition state** — standings, played fixtures/results, future fixtures.
7. **Player transformations** — TBG ratings, positions, values and contract initialisation.
8. **Finance** — only under the run's declared finance policy.
9. **Tactics/current selection** — optional translated seed state.
10. **H1 history** — transfers, changes, snapshots, match reports/events, season history.
11. **H2 reconstruction** — only after direct source history is loaded.
12. **Validation/reconciliation** — candidate remains quarantined until gates pass.
13. **Publish rehearsal** or **approve cutover candidate**.

No later phase may repair an earlier identity ambiguity by guessing.

---

## 8. Rehearsal import protocol

Rehearsals are a development feature, not a one-off migration script.

### 8.1 Named snapshots

Each rehearsal uses an immutable logical source boundary, for example:

```text
top100-sm-239138-2026-10-06T1800Z
```

The exact naming scheme is implementation detail; immutability and traceability are not.

### 8.2 Idempotence target

Running the same importer version + source snapshot + transformation versions twice into clean candidate worlds should produce equivalent canonical state and equivalent reconciliation counts.

Where generated TBG IDs differ physically, a stable semantic comparison must still pass.

### 8.3 Refresh/diff rehearsal

At least one test path must import snapshot A, then evaluate snapshot B and report:

- added/removed managers;
- changed club assignments;
- squad ins/outs;
- player field/rating changes;
- new transfers;
- new/changed fixtures/results;
- standings movement;
- finance/tactics changes;
- identity conflicts;
- historical records newly discovered retrospectively.

### 8.4 Destructive safety

Rehearsal worlds must be unmistakably non-live. The importer must require an explicit target mode and refuse to overwrite the authoritative world through a rehearsal operation.

---

## 9. Reconciliation report

Every run emits a human-readable and machine-readable reconciliation report.

Minimum sections:

### World
- source/TBG world identity;
- divisions/competitions counts;
- club counts and unmatched/duplicate clubs;
- source boundary.

### Managers
- source managers seen;
- managed clubs;
- vacancies;
- exact assignment matches;
- ambiguous/missing identities;
- imported tenure facts versus reconstruction.

### Squads / players
- players by club and total;
- source IDs unique/duplicate;
- stale memberships removed by authoritative scope;
- players created from minimal transfer/change identity then enriched;
- unmatched/ambiguous players;
- source versus TBG rating/value/position transformation deltas.

### Competition
- standings row-by-row comparison;
- played fixture/result counts;
- future fixture counts;
- orphan/duplicate fixture IDs;
- points/goals/played recomputation differences where possible.

### Transfers / changes / history
- source records accepted/rejected/deduplicated;
- occurrence identity used;
- history by H1/H2/H3 tier;
- source records excluded and reason.

### Finance
- source snapshots available;
- chosen finance migration policy;
- exact/rejected/initialised balances;
- warning that absent chronology is not reconstructed.

### Tactics
- latest snapshots available;
- mapped/unmapped formation/instructions;
- seed state imported or intentionally omitted.

### Gate result

One of:

- `PASS_REHEARSAL`
- `PASS_CUTOVER_CANDIDATE`
- `FAIL_IDENTITY`
- `FAIL_CURRENT_STATE`
- `FAIL_TRANSFORMATION`
- `FAIL_COMPLETENESS`
- `FAIL_POLICY`

A warning may coexist with a rehearsal pass. A cutover-blocking discrepancy may not.

---

## 10. Ambiguity and conflict policy

### 10.1 Never guess identity from name alone

If stable IDs conflict or are absent, quarantine the record and report it.

### 10.2 Prefer authoritative scope over stale membership

For squads, the approved squad capture is authoritative for current membership of `(setupId, clubId)` at that capture boundary. Players absent from the authoritative scope should not linger as current members merely because an older snapshot contained them.

### 10.3 Minimal identities may be enriched, not duplicated

If a transfer/player-change event introduces a `playerDataId` before a squad capture, a minimal source player may exist. A later squad import enriches that identity rather than creating a second player.

### 10.4 Occurrences need occurrence identity

Repeated rating/position changes must not collapse merely because player + new value look alike. Use source event/change ID and date/turn discriminators where available. Records without sufficient occurrence evidence are not promoted to canonical H1 history.

### 10.5 Conflicting source surfaces

When two source surfaces disagree:

1. retain both observations;
2. apply a documented authority rule if one exists for that field/context;
3. otherwise quarantine the canonical decision;
4. report the conflict with both source references.

Do not resolve disagreement by whichever collector ran last.

### 10.6 Manual overrides

Any manual reconciliation required for cutover must be stored as a versioned migration decision with:

- affected source identity;
- original observations;
- chosen mapping/value;
- reason;
- author/time;
- scope of applicability.

It must be replayable on the next rehearsal, not a database edit performed after import.

---

## 11. Historical backfill policy

Historical collection may continue improving while TBG 2 is developed.

Current known mechanisms include direct club schedule walking and world-independent recursive fixture traversal from match reports. The latter is the preferred general direction, but its real coverage across league/cup/SMFA/friendly competition types and older seasons must be measured rather than assumed.

Backfill rules:

- rate-limit and bound collection;
- store approved normalised source observations separately from TBG history;
- deduplicate on stable fixture/event identity;
- never downgrade an existing higher-confidence record with a weaker later observation;
- allow newly discovered H1 history to enrich rehearsal worlds;
- after a live cutover, historical enrichment must use a separate audited history-import path and must not mutate sporting state already played in TBG.

---

## 12. Genuine SM freeze / cutover procedure

This procedure is deliberately future-facing. We do not need to leave SM to build and test it.

### C-30 days or earlier — readiness

- repeated full rehearsals are green;
- P0 TBG loop passes preference/reliability testing;
- importer/transformation versions are release candidates;
- outstanding ambiguity register is empty for current-state blockers;
- historical gaps are documented and accepted;
- finance/contract/tactics boundary policies are decided;
- managers are told what will and will not migrate.

### C-7 days — dress rehearsal

- take a fresh full source snapshot;
- run the exact proposed cutover pipeline;
- publish reconciliation report;
- manually verify a representative set of clubs, including Hamburger SV and clubs with recent transfers/manager changes;
- verify mobile login and core loop against the candidate;
- rehearse rollback-by-abandoning-candidate.

### Freeze announcement

Declare a precise SM freeze boundary. Managers must know which actions after that boundary will **not** migrate.

Ideally freeze occurs immediately after a natural completed match/turn and before managers make new transfer/tactical actions for the next TBG-controlled turn.

### Final SM capture

1. record source world/season/turn/time boundary;
2. capture world/competition state;
3. capture all 100 authoritative squad scopes;
4. capture current manager assignments;
5. capture fixtures/results/standings;
6. capture transfers/player changes through the boundary;
7. capture finance if it is part of continuity;
8. capture tactics only if the agreed policy imports them;
9. capture/backfill final completed match reports/events required for current-season history;
10. lock the approved final source snapshot.

### Build candidate

- run importer from the locked snapshot;
- run all transformations;
- emit reconciliation;
- no live manager writes during candidate construction.

### Cutover gate

Require `PASS_CUTOVER_CANDIDATE` plus explicit human approval. At minimum verify:

- 100-club world structure (or declared exact expected count);
- all current manager assignments/vacancies;
- every current squad scope;
- current table and played results;
- future schedule needed to continue;
- rating/value/contract transformation reports;
- finance policy result;
- no blocking ambiguity/conflict.

### Publish

- assign immutable migration manifest to the new live world;
- enable manager access;
- Soccer Manager becomes historical/source reference, not a parallel authority;
- TBG becomes authoritative before any new TBG transfer/team/match action is accepted.

### No dual-write fantasy

Do not attempt to keep SM and TBG mutually authoritative after cutover. There must be one sporting source of truth. If Top 100 chooses TBG, post-cutover actions happen in TBG.

### Emergency failure

If the candidate fails before TBG opens for writes, abandon it, remain on SM, capture again later.

If TBG has already accepted live sporting actions, rollback to SM is no longer a simple technical restore: it becomes a governance decision about lost/divergent actions. This is why the gate exists.

---

## 13. Cutover acceptance checklist

A real migration is ready only when all statements are true:

- [ ] We can recreate a clean rehearsal world repeatedly from an immutable source snapshot.
- [ ] Stable identity coverage is complete for current world, clubs, managers and players.
- [ ] All 100 current squad scopes reconcile without silent leftovers.
- [ ] Current standings and played results reconcile.
- [ ] Required future fixtures reconcile.
- [ ] Every transformed field has a named/versioned rule.
- [ ] Source SM ratings/values remain inspectable beside TBG transformations.
- [ ] Finance continuity has an explicit accepted policy.
- [ ] Contract/wage initialisation has an explicit accepted policy.
- [ ] Tactics import/omission has an explicit accepted policy.
- [ ] Historical records are classified H1/H2/H3/H4 rather than flattened into fake certainty.
- [ ] Manual overrides, if any, are versioned and replayable.
- [ ] Reconciliation is machine-readable and human-readable.
- [ ] A fresh dress rehearsal passes using the same pipeline intended for cutover.
- [ ] Managers have been told the freeze boundary and migration limitations.
- [ ] The TBG P0 management loop is preferable/reliable enough to justify moving at all.

---

## 14. What this specification does not decide

The following belong to subsequent design/architecture work:

- database/schema technology;
- whether the importer lives in Manager Lab, a dedicated migration package or another service;
- exact TBG player valuation formula;
- exact contract/wage conversion;
- exact SM tactic → TBG tactic mapping;
- final finance model;
- UI design for reconciliation/admin tools;
- licensing/asset policy for crests/player images;
- whether Top 100 actually leaves Soccer Manager and on what date.

Those decisions must satisfy this contract rather than quietly weaken it.

---

## 15. Architecture questions exposed by the import contract

The next artefact is the **TBG 2 Architecture Decision**. It should now answer concrete questions:

1. Where does immutable/approved Soccer Manager source evidence live?
2. Where does the source-ID ↔ TBG-ID registry live?
3. Can Manager Lab remain the collector/evidence system while TBG consumes an explicit export/import contract?
4. Which Alpha canonical-state concepts are worth extracting rather than rewriting?
5. How are rehearsal worlds isolated from live state?
6. How are transformation versions represented and tested?
7. How does TBG preserve source provenance without coupling gameplay to Soccer Manager schemas?
8. What is the smallest architecture capable of the P0 loop without recreating Alpha's accumulated application complexity?

The architectural default should be separation:

> **Sync observes Soccer Manager. Import transforms approved evidence. TBG owns the playable world.**

---

## North star

Top 100's portability is not achieved by scraping lots of data. It is achieved when we can repeatedly prove that a declared Soccer Manager world state becomes the same recognisable, internally coherent TBG world — with every transformation explained and every uncertainty admitted.

Only then does “we could replace Soccer Manager if it disappeared” become an operational capability rather than a comforting idea.