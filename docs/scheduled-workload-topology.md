# Scheduled workload topology

All automatic production schedules are owned in **one place: `netlify.toml`**.

Function modules must not export their own Netlify `config.schedule`. The inventory test enforces this rule so a recovery pause or cadence change cannot miss a hidden trigger.

## Classes

- **Game-critical:** fixture locking, fixture execution, scheduled world turns. Their timing is part of game semantics; do not stagger them casually.
- **Checkpoint writers:** player-release settlement and world-turn processing. These can rewrite the canonical world and must never be deliberately overlapped.
- **Derived repair:** match archive/read-model reconciliation. It may lag safely and should run away from game-critical boundaries.
- **Background:** transfer settlement, notification email, inactivity enforcement/check-in, maintenance. These are safe to stagger.

The old standalone `refresh-world-read-model` schedule is retired. The world-turn path projects the read model immediately after checkpoint commit; `refresh-match-archives` is the checksum-aware repair path.

## Failure policy

Scheduled jobs must fail quiet when Supabase is unhealthy:

1. run a cheap Auth health preflight before expensive database work;
2. bound outbound fetches;
3. do not start the same logical job twice in one warm runtime;
4. after repeated database failures, open a best-effort warm-runtime circuit breaker;
5. return a successful `skipped` result for health/circuit skips so infrastructure retries do not amplify an outage.

Database-side claim/checksum primitives remain the authoritative cross-instance concurrency protection. The runtime guard is load shedding, not a replacement for those invariants.

## Recovery state

Following the 26–28 September 2026 outage, schedules remain centrally paused until the guarded jobs are deployed and a quiet baseline is observed. Restoration is a separate, deliberate change: low-cost background work first, scheduled world turns last.
