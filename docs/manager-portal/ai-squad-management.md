# Deterministic AI squad management

This module is the first milestone of the Road to Playable Persistent World roadmap in issue #67.

It turns the compact squad-intelligence contract into deterministic, auditable squad actions during an open transfer and registration period.

## Decisions

For each club the planner:

1. renews expiring registered players who are not classified as surplus;
2. registers suitable owned senior players to repair positional or hard-minimum gaps;
3. promotes the strongest ready youth prospect when a registration place exists;
4. recruits deterministic free agents to repair remaining positional gaps;
5. adds further free agents, where available, until the preferred senior range is reached.

Every applied action is recorded in the squad-cycle event ledger as an `ai_squad_decision_applied` event with a plain-language reason.

## Planning contract

The planner inherits the squad-intelligence defaults:

- hard minimum: 18 registered seniors;
- preferred minimum: 22 registered seniors;
- minimum cover: 2 goalkeepers, 6 defenders, 5 midfielders and 3 attackers.

Specific Transfermarkt-style player positions remain canonical. The intelligence layer derives the broad planning groups only for coverage calculations.

## Determinism

Candidate ordering is rating-first with player ID as the stable tie-breaker. Clubs are processed in stable club-ID order. Planning is side-effect free; execution applies the exact planned action sequence.

## Scope boundary

This is not yet a negotiated transfer market. It does not include fees, agents, player consent, budgets, competing bids, club philosophies or sophisticated disposal policy. It provides the minimum autonomous repair loop required to keep AI squads viable and explain why each action occurred.
