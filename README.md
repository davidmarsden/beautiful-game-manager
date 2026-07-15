# The Beautiful Game — Manager Portal

The human-facing web application for **The Beautiful Game**.

This repository owns:

- manager authentication and club access;
- dashboard, squad, tactics, schedule and competition views;
- team-sheet and tactical decision submission;
- manager inbox, notifications and deadlines;
- later transfer, contract, youth and finance interfaces.

It consumes canonical world data from `beautiful-game-engine` and football data from `beautiful-game-data`. It does not run the match simulation itself.

## Current milestone

**Phase 2C — Manager Portal MVP and decision-submission API**

The first version provides an SMW-familiar, tablet-first dashboard and a validated team-selection submission contract. Browser deployment previews are part of the delivery model: the project owner must not need local npm commands to test the game.
