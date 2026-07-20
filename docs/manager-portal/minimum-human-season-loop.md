# Minimum human manager season loop

PR #64 adds the first complete human-controlled path through one football season.

## Scope

A caller can now:

1. choose one club;
2. inspect its squad and full league schedule;
3. submit a default formation, tactics and optional exact starting XI;
4. add matchday-specific tactical or formation overrides;
5. resolve every league fixture through the constitutional engine while all other clubs remain AI-managed;
6. receive the human club's match ledger, final table position and full-season integrity verdict.

This is deliberately the smallest useful manager loop. It proves the product path around the accepted match engine without prematurely building transfers, contracts, youth intake, finances or a large interface.

## Public functions

### `prepareHumanManagerSeason(...)`

Returns a deterministic pre-season dashboard containing:

- controlled club identity;
- squad list with positions and ratings;
- home/away schedule;
- opponent and kickoff information;
- number of required match decisions.

### `playHumanManagerSeason(...)`

Consumes:

- `humanClubId`;
- a default instruction;
- optional matchday overrides.

A human instruction may contain:

```js
{
  formation: '4-3-3-wide',
  tactics: {
    style: 'possession',
    route_to_goal: 'wide',
    pressing: 'mid',
    tempo: 'normal',
    mentality: 'balanced'
  },
  starting_xi: ['player-1', 'player-2', '...']
}
```

An exact XI must contain eleven unique players from the available 18-player matchday squad. Omitting it keeps the deterministic AI-selected XI while still applying the human formation and tactical plan.

## Deliberate boundary

This PR is an orchestration layer, not the final tablet interface. It establishes the stable domain contract that a responsive interface can call next. It also leaves the accepted AI fallback hierarchy from PR #60 untouched: natural positions, supported alternatives, senior out-of-position cover, then temporary emergency youth only when necessary.

## Acceptance

The generated report passes only when:

- the underlying season harness completes;
- the human club plays its full schedule;
- one human decision is recorded for every human fixture;
- every human XI contains eleven unique players;
- tactics are present for every human fixture;
- a final league position is available.

Generated evidence:

- `calibration/generated/human-manager-season.json`
- `calibration/generated/human-manager-season.md`
