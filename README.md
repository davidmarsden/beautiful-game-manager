# The Beautiful Game — Manager Portal

The human-facing web application for **The Beautiful Game**.

This repository owns:

- manager authentication and club access;
- dashboard, squad, tactics, schedule and competition views;
- team-sheet and tactical decision submission;
- manager inbox, notifications and deadlines;
- transfer, contract, youth and finance interfaces as those systems enter the playable product.

It consumes canonical world data from `beautiful-game-engine` and football data from `beautiful-game-data`. It does not run the match simulation itself.

## Current status — TBG 2 product definition

**Alpha 1 is complete and archived.** Its final implementation is preserved at the `alpha1-final` marker and its findings are recorded in [`docs/alpha-1-post-mortem.md`](docs/alpha-1-post-mortem.md).

The project is now defining **TBG 2**: a potential replacement game for the Top 100 community, using Soccer Manager as the behavioural floor rather than the design ceiling.

The north star is:

> **Alpha 1 proved feasibility. TBG 2 must prove preference.**

The current product definition is [`docs/tbg-2-product-brief.md`](docs/tbg-2-product-brief.md).

No Alpha-era roadmap should be treated as the active TBG 2 implementation backlog. The next design artefacts are:

1. Soccer Manager → TBG Capability Map;
2. Top 100 Import Specification;
3. Architecture Decision;
4. a deliberately narrow core vertical slice: **Home → Squad → Player → Transfers → Team & Tactics → Match → Table**.

Implementation architecture and repository changes should follow those decisions rather than precede them.
