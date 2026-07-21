# Persistent five-division world

PR #75 connects the accepted canonical `d1`–`d5` league structure and promotion/relegation rollover to the versioned persistent-world save contract.

## Persistent competition state

Each save now carries a `competition` section containing:

- canonical division IDs and levels (`d1=1` through `d5=5`);
- the current club membership of every division;
- the configured movement count per boundary;
- an immutable cross-season movement history.

A valid save must contain every world club exactly once across the five divisions. Swapped levels, missing divisions, duplicate membership and clubs outside the squad-cycle state are rejected.

## Season execution

Every persistent league season:

1. renews the human club's expiring registered players and runs deterministic AI squad management for the other clubs;
2. proves all 20 clubs are viable;
3. simulates all five divisions, using the human-manager loop in the human club's division;
4. creates one reconciled archive per division;
5. applies the accepted promotion/relegation algorithm to the stored division membership;
6. records eight stable movement events when one club moves in each direction across each of the four boundaries;
7. processes youth intake and contract expiry;
8. rolls the calendar and squad-cycle season forward;
9. runs AI squad repair and returns to a valid next preseason;
10. saves and reloads the resulting multi-division world.

## Acceptance boundary

The CI report runs two consecutive seasons with five divisions of four clubs. It requires:

- ten unique division archives;
- sixteen persisted promotion/relegation movements;
- canonical division levels after every rollover;
- every club preserved exactly once;
- complete human fixture decisions;
- AI management of all nineteen autonomous clubs before and after each season;
- viable next-season squads;
- clean save/load validation.

This connects promotion and relegation to persistence. It does not yet change the whole-season execution boundary to matchday-by-matchday advancement, and it does not add playoff or appeal workflows.
