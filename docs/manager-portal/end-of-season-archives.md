# End-of-season archives, awards and records

Version: `tbg-season-archive-v1.0`

This module turns a completed deterministic season into a durable historical record suitable for persistence and the manager portal.

## Archive contents

Each archive stores:

- the final reconciled league table;
- champions and club season summaries;
- fixture source IDs;
- player starts, appearances and bench records;
- goals, assists and cards when the source result exposes those events;
- deterministic club and player awards;
- deterministic season records;
- reconciliation checks proving the archive matches the completed season.

The archive does not invent unsupported player statistics. Goal, assist and card totals remain zero unless public match events provide player attribution.

## Deterministic awards

The initial award contract includes:

- champion;
- best attack;
- best defence;
- golden boot;
- assist leader;
- appearance leader.

Stable numeric criteria are followed by player or club ID tie-breaking. Rebuilding an archive from identical season state therefore produces identical awards.

## Reconciliation

An accepted archive must prove:

- every source fixture is linked exactly once;
- final standings reconcile played, wins, draws, losses and points;
- goals for equal goals against across the competition;
- player starts equal 22 per completed fixture;
- exactly one champion exists;
- award winners reference archived entities.

## History index

`appendSeasonArchive` adds accepted archives to a stable history index and rejects duplicate season IDs. This is the foundation for future save/load persistence, historical queries and portal season pages.

## Scope boundary

This PR creates immutable archive data, awards and records. It does not yet provide database storage, save files, cross-season career totals, narrative generation, cup archives or portal components. Those build on this versioned archive contract.
