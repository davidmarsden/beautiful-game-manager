# Playable World Release Candidate

`playable-world-rc1` is the acceptance boundary for the first persistent playable-world slice.

It does not claim that The Beautiful Game is feature-complete. It proves that the currently delivered loop can survive repeated deterministic seasons without losing identity, history, squad viability or save/load equivalence.

## Soak contract

The release-candidate generator runs twelve consecutive seasons with:

- one human-managed club;
- autonomous AI squad management for every other club;
- a human decision recorded for every human fixture;
- season archives created from the exact played fixtures;
- youth intake, contract expiry, free agency and squad repair;
- a persistent event ledger and save envelope;
- a return to a valid preseason after every rollover.

The same world is then run again from the same initial identity. Its final canonical save must be byte-for-byte deterministic.

A third run is split at the midpoint, saved, resumed and completed. Its final canonical save must match the uninterrupted run exactly.

## Acceptance gates

The candidate is accepted only when:

- every season and every internal season check passes;
- continuous, repeated and resumed runs converge on the same final save;
- archives are unique and match the number of completed seasons;
- the world advances by exactly one season per cycle;
- all final squads satisfy the playable hard minimum and positional coverage;
- every owned player has the correct active contract;
- world and squad-cycle event IDs remain unique;
- human fixture decisions and AI preseason squad cycles are complete;
- the final world validates and returns to preseason.

## Evidence

CI produces:

- `reports/generated/playable-world-release-candidate.json`
- `reports/generated/playable-world-release-candidate.md`

The report is part of `npm run calibration:gate` and therefore blocks merge when the playable-world release boundary fails.

## Scope boundary

This release candidate covers the current single-division persistent loop. The existing five-division promotion and relegation harness remains separately accepted, but its movement model is not yet connected to persistent-world saves.

Fixture-by-fixture transactional persistence, full transfer negotiation, finances, manager careers, player development, cup competitions and production-scale 100-club operation remain later delivery work.
