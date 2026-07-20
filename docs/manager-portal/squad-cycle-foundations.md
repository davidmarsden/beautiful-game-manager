# Squad-cycle foundations

PR #65 adds the first deterministic domain contract for changing squads between and during seasons.

## Transfer windows

Each season exposes two transfer windows:

- a summer window spanning pre-season and the opening month;
- a winter window in the middle of the season.

A transfer must occur inside an open window. The operation moves ownership, ends the previous registration, creates a new contract, registers the player for the destination club and records immutable events.

## Registration

Registration is separate from ownership. A club may own an unregistered player, including a new youth intake player. Registration validates:

- current club ownership;
- an open registration period;
- the configured senior registration limit;
- no duplicate registered membership.

The registration ledger therefore remains explicit rather than being inferred from the squad array.

## Contracts

Every owned player has one current active contract. The foundation supports:

- initial contracts;
- renewals with a new end date and wage;
- contracts created on transfer;
- deterministic expiry processing;
- release to free agency when an active contract expires.

Expired players are removed from the club squad and registration list but remain in the player universe.

## Youth intake

Every club can receive a deterministic annual intake. The initial constitutional band is deliberately narrow:

- ages 16–18;
- ratings 65–70;
- three players per club by default;
- deterministic IDs, positions, ages and ratings;
- academy contracts created immediately;
- players begin unregistered.

This is the discovery and ownership foundation, not the final youth-development model.

## Event ledger

Every mutation records a unique event, including registrations, removals, transfers, renewals, expiries and youth creation. This gives later history, media and audit systems a stable source rather than reconstructing events retrospectively.

## Scope boundary

This PR does not yet implement:

- transfer negotiation, agents or competing bids;
- budgets, accounting or affordability;
- AI recruitment strategy;
- player consent or promises;
- detailed registration exemptions;
- youth potential, development or promotion decisions.

Those systems can build on this state contract without changing the match engine.
