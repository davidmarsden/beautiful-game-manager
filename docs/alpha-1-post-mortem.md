# The Beautiful Game — Alpha 1 Post-mortem

**Status:** final Alpha 1 retrospective  
**Alpha closure initiated:** 29 September 2026  
**World:** `tbg-world-1`  
**Frozen code marker:** `alpha1-final`

## Executive summary

Alpha 1 proved feasibility. It did not prove preference.

The experiment demonstrated that The Beautiful Game could operate as a real persistent multiplayer football-management world: managers could take clubs, inspect squads, select teams and tactics, play fixtures, process results, use transfers and communications, and participate under an explicit governance model. Sixteen genuine non-admin managers participated between late August and late September 2026.

But participation declined and the world did not retain those managers without reminders and intervention. Alpha 1 was ultimately archived rather than extended through another cycle of patches and feature development.

The strongest direct retrospective signal is not that managers rejected TBG's football simulation. The limited feedback received instead concentrated on the experience of using the product: bugs and things not working, slowness/clunkiness, and UI/UX that one manager described as feeling like a game from the 1990s. Four of nine members of the Alpha WhatsApp group answered the single-choice issue poll; two selected bugs/things not working, one selected slow/clunky, and one selected Other and subsequently identified UI/UX. Sixteen retrospective emails were successfully sent and accepted by the email provider, but no substantive email responses were received by the time this post-mortem was written.

That evidence is too small to rank causes confidently, and non-response cannot tell us why individual managers disengaged. It is nevertheless consistent with the operational experience of Alpha 1: reliability, performance and interaction friction repeatedly got between managers and the underlying game.

The conclusion is therefore not that TBG's core idea failed. It is that Alpha 1 has run its useful course. Continuing to patch the existing product would protect sunk cost rather than answer the next question.

**Alpha 1 proved that we can build the game. TBG 2 must prove that Top 100 managers would choose it over Soccer Manager.**

## 1. What Alpha 1 was testing

Alpha 1 grew from a much larger design programme: reproducible player ratings, a bespoke match engine, persistent worlds, tactics, transfers, contracts and agents, scouting, youth discovery, finance, manager careers, information/media and governance.

The pre-feedback closure snapshot correctly identified the minimum recurring loop as:

**Squad → Transfers → Team Selection → Tactics → Match → Table → Consequences → Repeat**

In practice, Alpha 1 tested two things at once:

1. whether the underlying systems could be made to work together in a persistent multiplayer world; and
2. whether experienced Soccer Manager / Top 100 managers would want to keep returning to that world.

The first test succeeded. The second did not.

That distinction matters. Technical and simulation feasibility are necessary, but they are not the product.

## 2. What happened

Sixteen genuine non-admin managers held Alpha 1 appointments. The first genuine cohort appointments began on 26 August 2026; appointment activity continued into late September.

Managers encountered a succession of operational and product problems during the Alpha. These included first-login and account friction, bugs in game flows, performance/slowness, incomplete or unfamiliar behaviours relative to Soccer Manager, constrained transfer activity and a world in which declining participation itself reduced interaction and market activity.

Activity reminders and inactivity enforcement became necessary. Managers were eventually removed for inactivity. This was itself a warning sign: a football management game should ideally create reasons to return before governance machinery has to manufacture them.

By late September, further patching was unlikely to answer the central product question. Alpha 1 was therefore deliberately closed and preserved as a read-only archive.

The final canonical world was backed up at matchday 20. Automatic game-mutating schedules were stopped, the world was marked archived/read-only at the database boundary, and the manager-facing application was converted into an Alpha 1 archive rather than deleted.

## 3. Evidence

### 3.1 Observed behaviour

The strongest evidence of disengagement is behavioural rather than retrospective. Managers stopped checking and participating regularly; reminders and inactivity actions were required; participation did not recover sufficiently to sustain the world.

The precise timing of disengagement is therefore not a useful retrospective question: the application records already tell us broadly when managers stopped participating. The more important unanswered question is why.

### 3.2 Retrospective outreach

A retrospective email was successfully sent to all 16 genuine Alpha participants and accepted by the email provider. The delivery ledger records provider message IDs, but does not independently establish downstream delivery or bounce status. The email asked what they enjoyed, what annoyed them, when they lost interest, what was missing compared with Soccer Manager / Top 100, and what TBG should keep.

No substantive email responses had been received when this post-mortem was finalised.

The Alpha WhatsApp group produced a small but clearer signal. Four of nine members answered the poll:

> **What was the single biggest issue with playing TBG for you?**

- **2 — Too many bugs / things not working** (Hugo, Matteo)
- **1 — Too slow or clunky to use** (Rob)
- **1 — Other** (Pane)

Pane explained his Other response as **UI/UX**, adding that it felt like he was playing a game "back in the 90s".

This is a tiny sample and must not be presented as representative polling. It is qualitative evidence from the managers who chose to respond.

### 3.3 What the feedback does and does not establish

All four respondents identified problems at the product/interface layer rather than naming the match engine, tactical model, ratings model or underlying football-management concept as their single biggest issue.

That does **not** prove that those deeper systems were compelling. Product friction may simply have prevented managers from engaging with them deeply enough to judge them. Nor does silence from the remaining managers prove any particular cause.

It does, however, mean that Alpha 1 cannot fairly be read as a clean test in which a polished implementation exposed a weak game design. Reliability, speed and UX were themselves major experimental variables.

## 4. Findings

### Finding 1 — Feasibility is established

A persistent multiplayer football-management game built around TBG's own systems is achievable. Alpha 1 moved this from an idea and a collection of constitutions into something real people could play.

That is the principal success of the Alpha.

### Finding 2 — Reliability and speed are product features

Bugs and slowness are not secondary polish issues in this kind of game. They interrupt the recurring management loop and teach managers that opening the game may cost them time.

TBG 2 should be boringly reliable and fast before it is broad.

### Finding 3 — Familiarity matters

Top 100 managers already possess years of Soccer Manager muscle memory. Alpha 1 sometimes looked familiar while behaving differently, incompletely or less smoothly. That imposed a learning cost without immediately compensating managers with a better experience.

The next version should use Soccer Manager's successful interaction patterns as a behavioural baseline wherever doing so reduces unnecessary relearning.

### Finding 4 — Retro presentation and retro UX are different things

TBG's text-led retro character was intentional. Its inspirations include football newspapers, Teletext/Ceefax, vidiprinter results and play-by-mail management games. Pane's criticism should therefore not be rewritten as an accidental design failure or as evidence that retro football culture must be abandoned.

The useful distinction is:

**The world can feel old. The interface must not feel old to operate.**

TBG can retain an analogue football soul while using modern application architecture, responsive interaction, excellent mobile design, immediate feedback and contemporary information hierarchy.

### Finding 5 — The social and economic world must be alive

A multiplayer football world weakens recursively when participation falls. Fewer active managers means fewer negotiations, fewer rivalries, less market activity and fewer reasons for the remaining managers to return.

A replacement for Top 100 should begin with the community and world managers already recognise, rather than asking a small test cohort to manufacture a social world from scratch.

### Finding 6 — Alpha 1 accumulated breadth before proving the core loop

The constitutions and roadmap contain many valuable ideas, but implementation breadth got ahead of proof that the everyday loop was pleasurable enough.

Future depth should be earned by a working core product. Contracts, agents, youth systems, media, manager careers and other simulation layers should not delay or destabilise Squad, Player, Transfers, Team & Tactics, Match and Table.

## 5. What survives Alpha 1

Alpha 1 should be treated as R&D, not as a product that must be preserved through incremental refactoring.

The strongest assets to carry forward are:

- the match-engine work and calibration/stress-test methodology;
- the reproducible player-rating system and Transfermarkt-derived research/data pipeline;
- the principle of a persistent shared football world with meaningful consequences;
- the governance model and lessons from operating a real manager community;
- Top 100 chat/community work;
- the accumulated design constitutions as a research and design library rather than implementation commandments;
- the roadmap toward richer contracts, agents, scouting, youth, information and manager careers;
- the operational lessons of running Alpha 1;
- Soccer Manager Sync / Manager Lab knowledge and data, which now provide a much stronger behavioural and data specification for a replacement game.

Nothing in Alpha 1's application architecture or UI is protected by sunk cost.

## 6. What needs rebuilding

The areas requiring the most substantial rethink are also the areas closest to everyday management:

- the in-game player database and data model;
- player profiles and the richness/clarity of player information;
- squad views, sorting, filtering and comparison;
- scouting and player discovery;
- transfer-market browsing, availability, bidding and negotiation;
- team selection;
- formation and tactical selection;
- application navigation, loading behaviour and mobile interaction;
- the relationship between familiar Soccer Manager workflows and TBG's own visual identity.

These should be designed as one coherent information and interaction system, not as independent features accumulated over time.

## 7. The new product direction

TBG 2 should aim explicitly to become a **Top 100 replacement game**.

The ambition is no longer merely to create an alternative football-management simulation. It is to reproduce the things that make Top 100 on Soccer Manager understandable and compelling, remove the bugs and friction involved in playing it, and then extend beyond Soccer Manager using TBG's stronger foundations and longer horizon.

Soccer Manager becomes the **behavioural floor**, not the design ceiling.

The first TBG 2 world should therefore be recognisable as Top 100: familiar clubs, managers, squads, competition structure and history wherever our own captured data can support them. Soccer Manager Sync should be used to understand and, where appropriate, import that world rather than asking managers to start emotionally from zero.

The initial product loop should be deliberately narrow:

**Home → Squad → Player → Transfers → Team & Tactics → Match → Table**

No new simulation subsystem should take priority over making that loop fast, reliable, intuitive and enjoyable.

## 8. Product principles for TBG 2

1. **Recognisable before novel.** A Top 100 manager should understand the basic workflows without instruction.
2. **Fast by default.** Common interactions should feel immediate.
3. **Reliable before rich.** New depth does not justify breaking the core loop.
4. **Mobile-first.** The everyday management experience must be excellent on the devices managers actually use.
5. **Top 100-native.** The existing community, clubs, rivalries and history are assets, not test data to discard.
6. **Modern interaction, analogue football soul.** Retro is an aesthetic and cultural language, not permission for cumbersome UX.
7. **Progressive depth.** Sophisticated simulation should sit beneath a comprehensible surface.
8. **Persistent history.** The replacement game should remember the things Soccer Manager forgets or exposes poorly.
9. **Portable world.** Top 100 should no longer depend existentially on Soccer Manager continuing to exist.
10. **Prove preference before expanding scope.** Feature development follows evidence that managers prefer using the core product.

## 9. Acceptance test

The next version needs a harder standard than "it works".

A Top 100 manager should be able to move from Soccer Manager to TBG without needing to learn how to be a football manager again.

Within ten minutes they should be able to inspect their squad, open and understand player profiles, find players, make a transfer action, select a formation and XI, set tactics and submit their team without instruction.

And within those ten minutes they should encounter at least one thing that makes them think:

> **I wish Soccer Manager did it this well.**

The internal benchmark is even simpler: when the same Top 100 club exists in Soccer Manager and TBG, managing it in TBG should become the preferable experience.

## 10. What Alpha 1 achieved

Alpha 1 did not retain its manager cohort. That is the central negative result and should not be softened.

But it also crossed a threshold that once looked improbable: Top 100 managers were invited into and played a persistent football-management game developed specifically for this project. The systems were no longer theoretical. Real managers logged in, picked teams, encountered bugs, made decisions, became frustrated, disengaged and gave us evidence.

That evidence changes the project.

The appropriate response is not to keep Alpha 1 alive indefinitely. It is to preserve it, learn from it and build the next experiment around a much sharper question.

## 11. Decision

Alpha 1 is complete and archived.

Development should now proceed toward a new product definition rather than further Alpha 1 feature work.

The next two design artefacts are:

1. **TBG 2 Product Brief** — the concise definition of the replacement game, its audience, principles, minimum loop and acceptance criteria.
2. **Soccer Manager → TBG Capability Map** — a grounded audit of the Top 100 / Soccer Manager experience: what managers see and do, what Soccer Manager Sync can capture, what Alpha 1 already provides, and what TBG 2 must build or improve.

Only after those are complete should the implementation architecture and repository strategy be chosen.

---

## Final conclusion

**Alpha 1 proved feasibility. TBG 2 must prove preference.**

The aim is not to persuade Top 100 managers to tolerate a different football-management game because its simulation is interesting. The aim is to give them the game they already recognise, make it faster, more reliable and more pleasurable to use, preserve the football culture and community that matter to them, and then take it somewhere Soccer Manager cannot easily go.

**Nothing is sacred except the desire to play another match.**
