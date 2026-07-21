# Persistent season and offseason loop

Version: `tbg-persistent-season-loop-v1.0`

This layer connects the already accepted matchday, human-manager, AI squad-management, squad-cycle and season-archive contracts into one recoverable repeated-season flow.

## Loop order

1. Load and validate the current versioned world.
2. Apply the human club's explicit offseason continuity instruction.
3. Run deterministic AI squad management for every non-human club.
4. Reject the season start if any club is below the hard minimum or positional floor.
5. Save and reload at the season-opening checkpoint.
6. Play the complete season with one human-controlled club and autonomous opponents.
7. Create and persist the accepted season archive.
8. Generate each club's youth intake.
9. Process contract expiries and free agency.
10. Save and reload at the offseason checkpoint.
11. Roll the calendar, squad-cycle identity and dates into the next season.
12. Run AI squad repair for the new registration period.
13. Reject rollover if any next-season squad is not viable.
14. Save, reload and return the next preseason world.

## Persistence contract

`savePersistentWorld()` writes a canonical JSON envelope containing:

- save version;
- world-schema version;
- saved clock;
- SHA-256 payload checksum;
- the complete mutable world.

`loadPersistentWorld()` verifies the checksum and referential integrity before returning a world. It does not silently repair ownership, registration, contract, archive or event-ledger corruption.

The first schema persists:

- club profiles and the human appointment;
- players, ownership, registrations and contracts;
- transfer, registration, contract and youth events;
- season number, phase, calendar and world clock;
- complete season archives;
- world-level causal events;
- save/load checkpoints.

## Human decisions

Matchday decisions use the same validated `playHumanManagerSeason()` path as the existing portal and human-season acceptance work. The returned season now includes its complete underlying season report so the archive is built from the actual human-influenced fixtures rather than from a second simulation.

The temporary default offseason instruction is deliberately narrow: retain expiring registered players. It represents an explicit human continuity choice while richer contract screens and negotiation remain deferred.

## AI decisions

Every non-human club uses the accepted deterministic squad-intelligence and AI squad-management contracts. AI clubs are checked before the season and again after rollover. No club is allowed to enter the following season below the playable squad or positional minimum.

## Known boundary

The current match harness still advances a division season as one deterministic operation. Persistence checkpoints therefore sit immediately before the fixture cycle and during the offseason, not between individual matchdays. Fixture-by-fixture transactional advancement is a later operational refinement, not hidden or simulated here.

## Acceptance

The PR acceptance run completes two repeated seasons and proves:

- human decisions are recorded for every human fixture;
- all other clubs are managed autonomously;
- each season archive is accepted and stored once;
- youth, contract expiry and rollover execute in order;
- opening, offseason and final saves reload equivalently;
- history and event IDs remain unique;
- the following season begins with valid squads;
- repeating from the same seed produces the same world.
