# Squad intelligence

PR #66 adds the narrow intelligence layer exposed by the playable human-manager and squad-cycle loops. It interprets existing squad state; it does not add a broad new attributes or personality system.

## What it derives

For each club the intelligence report provides:

- owned, senior, registered and currently available player counts;
- positional depth across goalkeeper, defender, midfielder and attacker groups;
- hard-minimum and preferred-range squad gaps;
- contracts expiring this season and next;
- simple player squad roles: key player, starter, rotation, depth, prospect or surplus;
- structural recruitment needs caused by registration or positional shortages;
- temporary cover needs caused by injuries or suspensions.

## Viability rules

The default hard minimum is 18 registered senior players. The preferred minimum is 22. Position-group cover requires at least:

- 2 goalkeepers;
- 6 defenders;
- 5 midfielders;
- 3 attackers.

These are deliberately compact planning signals rather than complete formation-specific squad construction rules. They provide a shared contract for a human-manager portal and later AI recruitment decisions.

Owned but unregistered youth players remain visible as prospects but do not count as registered senior cover.

## Scope boundary

This PR does not add:

- manager personalities or recruitment philosophies;
- scouting uncertainty;
- morale, loyalty, ambition or promises;
- agent behaviour or contract negotiation;
- club culture and reputation modelling;
- a large new player-attribute model;
- automatic buying, selling or renewal decisions.

Those systems should only be added when a playable feature exposes a concrete need for them.
