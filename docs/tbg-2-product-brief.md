# The Beautiful Game 2 — Product Brief

**Status:** product definition before implementation  
**Predecessor:** Alpha 1 (`alpha1-final`)  
**North star:** **Alpha 1 proved feasibility. TBG 2 must prove preference.**

## 1. Product ambition

TBG 2 should become a credible **replacement game for Top 100**: a persistent multiplayer football-management game that experienced Top 100 managers immediately recognise, that removes the bugs and friction involved in playing Soccer Manager, and that can ultimately become richer than Soccer Manager because its simulation, data, history, community and governance are ours to develop.

The test is no longer whether we can build a football-management game. Alpha 1 answered that.

The test is:

> **Would a Top 100 manager rather open TBG than Soccer Manager to manage the same club?**

Soccer Manager is therefore the **behavioural floor, not the design ceiling**.

## 2. Who it is for

The first audience is not an abstract mass market. It is the existing Top 100 community: experienced managers with years of Soccer Manager muscle memory, established clubs, rivalries, expectations and shared history.

That gives TBG 2 an unusually demanding but useful product benchmark. Managers should not have to relearn ordinary football-management tasks merely because the software has changed.

The first development user is the project owner managing the same Top 100 club in both products. If ordinary management work remains easier or more pleasurable in Soccer Manager, TBG 2 is not ready to expand its scope.

## 3. Core proposition

TBG 2 should:

1. reconstruct the recognisable Top 100 world from data we can legitimately import or derive;
2. make its everyday management workflows familiar to an experienced Soccer Manager user;
3. make those workflows faster, clearer, more reliable and more pleasurable;
4. retain TBG's strongest original foundations where they improve the game;
5. gradually add depth that Soccer Manager cannot easily provide.

The initial proposition is not “learn our new football game”. It is:

> **Here is the Top 100 world you know. Now manage it somewhere better.**

## 4. Product principles

### 4.1 Recognisable before novel
Use successful Soccer Manager interaction patterns as a behavioural baseline where familiarity removes unnecessary learning. Do not copy friction merely because it is familiar.

### 4.2 Fast by default
Common actions should feel immediate. Loading, navigation, filtering, team selection and player inspection must not become reasons to leave the product.

### 4.3 Reliable before rich
A smaller feature set that works every time is more valuable than a sophisticated world whose core loop regularly breaks. Bugs are product failures, not merely polish debt.

### 4.4 Mobile-first
Top 100 is played in everyday life, not at a dedicated workstation. Core workflows must be excellent on phones and tablets as well as desktop.

### 4.5 Top 100-native
Existing managers, clubs, squads, competition structures, rivalries and history are product assets. Where our captured data permits, the first TBG 2 world should begin with recognisable Top 100 state rather than asking managers to become attached to a synthetic test world.

### 4.6 Modern interaction, analogue football soul
TBG's retro football culture survives: newspapers, Teletext/Ceefax, vidiprinter results, match reports, statistics, Saturday-afternoon rhythms and the imaginative qualities of text-led football.

Retro is an aesthetic and cultural language, not permission for cumbersome UX.

> **The world can feel old. The interface must not feel old to operate.**

### 4.7 Progressive depth
The simulation may be sophisticated underneath while the ordinary management surface remains understandable. Reveal complexity when it helps a decision rather than exposing the machinery by default.

### 4.8 Persistent history
The game should remember what happened: players, managers, clubs, transfers, matches, records, rivalries, honours and meaningful world events. History is part of why a persistent world matters.

### 4.9 Portable world
Top 100 should no longer depend existentially on Soccer Manager continuing to exist. TBG 2 should progressively make the community's football world portable and independently operable.

### 4.10 Prove preference before expanding scope
Do not add another major simulation subsystem until the core product gives managers a reason to prefer using it.

## 5. Initial product loop

The first vertical slice is deliberately narrow:

**Home → Squad → Player → Transfers → Team & Tactics → Match → Table**

These are not seven disconnected pages. They are one recurring management loop built around a coherent player, squad, club and competition information model.

### Home
Show what matters now: next fixture, recent result, table context, decisions requiring attention and relevant world activity. Do not turn the home screen into an administrative portal.

### Squad
Fast, dense and highly usable. Sort, filter, compare and understand the squad without fighting the interface. Make strengths, weaknesses, availability and selection context legible.

### Player
The player profile is a foundational object, not a thin detail page. It should support identity, rating, positions, age, club, value, contract, fitness/form, appearances, performance, rating history, transfer history, availability and relevant recruitment/scouting context, with progressive disclosure rather than one giant screen.

### Transfers
Searching, discovering, comparing, shortlisting, bidding and negotiating should be pleasurable. The market must feel populated and economically alive. TBG 2 should improve on Soccer Manager's friction rather than reproduce it.

### Team & Tactics
Selecting an XI, formation, bench and tactical plan should be among the best interactions in the game, especially on mobile. It should reuse the same player information model as Squad and Player rather than becoming a separate subsystem with different assumptions.

### Match
Retain the bespoke TBG match-engine foundation and the power of imagined football. The first requirement is not 3D graphics; it is that choices, commentary, statistics, reports and consequences make managers care about the result.

### Table
Competition state should be immediate, trustworthy and historically meaningful. Managers should understand where they stand and what is at stake.

## 6. What TBG 2 carries forward

Alpha 1 is R&D, not an application architecture that must be preserved.

Strong candidates to carry forward or extract include:

- the constitutional match engine and calibration/stress-test methodology;
- player-rating formulas and the reproducible real-player data pipeline;
- persistent-world and canonical-history concepts;
- governance principles and operational lessons;
- Top 100 community/chat work;
- transfer, contract, scouting, youth, information/media and career research as future design material;
- Soccer Manager Sync / Manager Lab data contracts, captured Top 100 state and behavioural knowledge;
- Alpha 1 evidence about auth, deployment, operations, failure modes and real manager behaviour.

Every inherited component must earn its place. Nothing in Alpha 1's UI or application architecture is protected by sunk cost.

## 7. What is deliberately not in the first build

The following remain valuable horizons but must not outrank the vertical slice:

- elaborate contracts and agents;
- youth academies and discovery systems;
- deep board-confidence systems;
- rich media/news simulation;
- manager career/reputation systems;
- elaborate financial simulation;
- complex multi-club transfer structures and loans beyond what the initial market needs;
- full historical reconstruction where source data is not yet available;
- 3D/graphical match simulation;
- feature breadth added primarily because Alpha 1 already implemented or planned it.

## 8. Data and Top 100 reconstruction

Before a new synthetic world generator becomes a priority, TBG 2 should define a **Top 100 World Importer**.

The completed **[Top 100 Import Specification](tbg-2-top100-import-spec.md)** defines the fidelity contract, historical migration tiers, transformation registry, rehearsal imports, reconciliation/ambiguity policy and eventual Soccer Manager freeze/cutover procedure. It is grounded in the working Soccer Manager Sync / Manager Lab source surfaces and stable identity model.

TBG's own data/rating pipeline should supplement or replace imported fields where it is the authoritative TBG source. Provenance must remain explicit: reconstruction should never silently invent historical facts.

## 9. Design relationship with Soccer Manager

TBG 2 is not a visual clone of Soccer Manager.

For each core workflow we should ask:

1. What does an experienced SM manager expect to happen?
2. Which part of that expectation is useful muscle memory?
3. Where does SM create unnecessary friction or limitation?
4. How can TBG preserve recognition while making the task materially better?
5. What TBG-specific depth belongs underneath or after the familiar action?

The completed **[Soccer Manager → TBG Capability Map](tbg-2-sm-capability-map.md)** is the evidence base for these decisions.

## 10. Acceptance test for the first vertical slice

Give an experienced Top 100 manager their recognisable club in TBG 2 without instructions.

Within ten minutes they should be able to:

- understand the home state and next fixture;
- inspect and sort their squad;
- open and understand player profiles;
- find and compare players;
- perform a meaningful transfer action;
- select a formation, XI and bench;
- set the initial tactical plan;
- submit the team;
- understand the competition table.

The experience should be fast and reliable throughout.

Within those ten minutes the manager should encounter at least one thing that prompts the reaction:

> **I wish Soccer Manager did it this well.**

The internal preference test is stronger still:

> When the same Top 100 club exists in Soccer Manager and TBG, ordinary management work should become preferable in TBG.

## 11. Success measures

Early success should be measured by behaviour and task quality, not feature count.

Useful measures include:

- task completion without instruction;
- response/navigation latency for core interactions;
- error/failure rate;
- time to select and submit a team;
- time to inspect/compare players and act in the market;
- voluntary return between fixtures;
- manager preference when the equivalent task exists in SM;
- qualitative reports of delight, confusion and friction.

Retention matters, but only after the core product is sufficiently reliable to make retention evidence interpretable.

## 12. Repository and version boundary

The existing repositories remain the project history and working homes unless the architecture decision later demonstrates a concrete reason to split or replace one.

- `beautiful-game-manager` continues to own the manager-facing product and playable-world application layer.
- `beautiful-game-data` remains the independently reproducible player/data/rating pipeline.
- engine/simulation code remains separately governed where already separated.
- Soccer Manager Sync / Manager Lab remains an input and evidence source rather than being casually folded into the game repository.

`alpha1-final` is the preserved Alpha 1 implementation marker. Alpha-era roadmaps and implementation issues are historical evidence, not the TBG 2 backlog.

TBG 2 implementation architecture is **not yet decided**. The completed capability map and import specification constrain the explicit architecture decision that comes next.

## 13. Delivery sequence

1. **Alpha 1 post-mortem** — complete.
2. **TBG 2 Product Brief** — this document.
3. **Soccer Manager → TBG Capability Map** — complete; maps real Top 100/SM workflows, Sync evidence, Alpha assets and TBG 2 gaps.
4. **Top 100 Import Specification** — complete; defines current-state fidelity, historical tiers, transformations, rehearsals, reconciliation, ambiguity and eventual cutover.
5. **Architecture Decision** — decide what to keep, extract, rewrite or retire and confirm repository/application structure.
6. **Core information/interaction prototype** — Player + Squad + Team & Tactics, grounded in imported Top 100 data.
7. **First vertical slice** — Home → Squad → Player → Transfers → Team & Tactics → Match → Table.
8. **Preference test** — compare real management tasks against Soccer Manager before broadening scope.

## 14. Decision rule

When choosing between preserving an Alpha implementation and making the replacement game simpler, faster and more recognisable, prefer the replacement game.

When choosing between a new feature and improving the core loop, improve the core loop.

When choosing between copying Soccer Manager and improving it, preserve useful familiarity and improve the rest.

---

## North star

**Alpha 1 proved feasibility. TBG 2 must prove preference.**

Build the Top 100 world managers already recognise. Make it faster, better-looking, more reliable and more pleasurable than the software they currently use. Preserve TBG's football soul and strongest simulation foundations. Then earn the right to make the world deeper.

**Nothing is sacred except the desire to play another match.**
