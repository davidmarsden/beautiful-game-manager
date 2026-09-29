# Alpha 1 Closure Snapshot

**Status:** pre-feedback record  
**Closure initiated:** 29 September 2026  
**Frozen code marker:** `alpha1-final` (created from `main` immediately after PR #452)  
**World:** `tbg-world-1`

This document records the working hypotheses at the moment Alpha 1 was closed, **before participant retrospective responses are analysed**. It exists so later findings are not rewritten by hindsight.

## Why Alpha 1 is ending

Alpha 1 demonstrated that TBG can support a persistent football-management world with manager accounts, squads, tactics, fixtures, match processing, transfers, communications and operational governance.

It did not yet demonstrate the more important thing: that experienced managers want to return to the game repeatedly without prompting.

The closure is therefore an intentional experiment boundary, not a declaration that the project or its underlying ideas have failed.

## Current hypotheses

These are hypotheses to test against participant feedback, not findings.

1. **The recurring game loop was not compelling enough.** The project accumulated a great deal of world simulation and supporting infrastructure before proving that Squad → Transfers → Team Selection → Tactics → Match → Table → Consequences was sufficiently enjoyable on its own.
2. **Complexity may have arrived before motivation.** Systems intended to create realism and depth could feel like work when managers were not yet emotionally invested in results.
3. **Matchday attachment may have been too weak.** A football management game ultimately needs managers to care about the next match, result and league position.
4. **Transfers and squad building may not yet have generated enough desire, rivalry or anticipation.**
5. **The controlled-alpha participation machinery may have conflicted with the intended principle of rewarding meaningful engagement rather than presence.** The guide said testing was not measured by login frequency; later inactivity rules introduced 3/7/10-day consequences.
6. **Off-platform behaviour is important evidence.** Discussion, tactical theories, transfer plotting and emotional reactions in Top 100/WhatsApp may tell us more about engagement than raw login counts.
7. **The extensive design constitutions remain hypotheses.** Their realism, internal coherence and implementation effort do not by themselves establish that the resulting systems are fun.

## Things that appear worth preserving

These too remain subject to evidence:

- reproducible, explainable player ratings;
- a persistent shared football world;
- meaningful manager agency;
- tactical trade-offs rather than one universal best tactic;
- incomplete information rather than arbitrary hidden randomness;
- preparation and decisions mattering more than constant presence;
- consequences that persist across matches and seasons;
- the social rivalry and shared history that make Top 100 compelling.

## Things explicitly open to replacement

Nothing in the Alpha 1 implementation is protected by sunk cost. In particular:

- match-engine architecture;
- tactical UI and complexity;
- fitness, cohesion and familiarity presentation;
- contracts, agents and player preferences;
- youth and scouting;
- manager career / board-confidence systems;
- media and information systems;
- portal architecture and workflow.

## Reboot question

> What is the smallest persistent football-management game capable of making an experienced Top 100 manager want to come back tomorrow?

The proposed minimum loop is:

**Squad → Transfers → Team Selection → Tactics → Match → Table → Consequences → Repeat**

Expansion should follow evidence of player pull, not precede it.

## Evidence to gather after closure

- retrospective email responses from genuine Alpha 1 participants;
- WhatsApp discussion and quick polls;
- actual Alpha participation and appointment history;
- match/submission/activity evidence;
- bugs and friction reported during the alpha;
- comparison with behaviour observed in Soccer Manager Worlds / Top 100;
- Manager Lab / SM Sync evidence where it can test specific hypotheses.

Participant feedback must be recorded separately from this pre-feedback snapshot so the two can be compared honestly.

## Archive rules

Alpha 1 should be preserved as evidence:

- preserve the final canonical world state and a closure backup;
- preserve database history, appointments, matches, submissions and operational records;
- keep automatic game-mutating schedules paused;
- make the manager-facing Alpha read-only rather than deleting it;
- keep retrospective/admin tooling available;
- do not resume Alpha 1 development while retrospective evidence is being collected;
- preserve a reconstructable code revision independently of later reboot work.

## Reboot doctrine

**Nothing is sacred except the desire to play another match.**
