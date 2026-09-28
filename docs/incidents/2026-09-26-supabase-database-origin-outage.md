# Incident post-mortem — Supabase database origin outage, 26–28 September 2026

**Status:** recovered; preventative work required before normal scheduler restoration  
**First confirmed sustained failure:** 2026-09-26 14:15:13 UTC  
**Last confirmed healthy data-plane response before failure:** 2026-09-26 14:07:34 UTC  
**Recovery:** 2026-09-28 after database restart  
**Data integrity:** no evidence of canonical-world corruption or data loss found

## Executive summary

The TBG Supabase project entered an unresponsive database state on 26 September and remained effectively unavailable until restart on 28 September. The visible symptom was initially manager login failure, but login-stage diagnostics proved that Supabase password authentication itself was timing out. Edge logs then showed Auth, PostgREST reads and scheduled RPCs failing together with HTTP 522 origin timeouts.

The strongest supported diagnosis is **database-level resource exhaustion or a crashed/unresponsive database**, not a frontend or Auth defect. Supabase documents the observed combination of API 522/525 responses and SQL connection timeouts as characteristic of an overloaded/crashed database, commonly associated with memory/resource exhaustion.

The precise exhausted resource cannot be proven from retained evidence: incident-window PostgreSQL logs and historical CPU/RAM/swap/I/O telemetry were unavailable. A load spike between 14:07 and 14:15 UTC on 26 September is the strongest trigger candidate, but this post-mortem deliberately distinguishes the proven failure mode from likely contributors.

## Impact

- Password sign-in and existing-session Auth checks failed.
- Canonical-world reads and service-role RPCs failed.
- Scheduled match, transfer, notification and projection workers repeatedly retried work against the unavailable origin.
- On 27 September retained edge logs contain **4,014 requests: 4,014 HTTP 522, 0 HTTP 200**.
- During diagnosis, direct SQL management access failed with `Connection terminated due to connection timeout`.
- The control plane could report the project healthy while its data plane was unusable.

## Timeline

### Healthy immediately before failure

At 13:55–14:05 UTC on 26 September the same endpoints later seen failing were healthy. Typical origin times were ~100–900 ms: fixture claims ~134–141 ms, submission-lock claims ~140–320 ms, canonical-world reads ~150–977 ms, and transfer/free-agent due checks ~140–480 ms.

At 14:07 the hourly player-release settlement ran:

1. canonical reads completed in 694–947 ms;
2. `apply_player_data_release_settlement` succeeded in **10.826 s**;
3. a subsequent canonical read succeeded in **1.961 s**.

This was significant load but is not sufficient evidence that settlement caused the crash. On 25 September another settlement took 14.777 s and an overlapping request failed after 41.685 s with HTTP 520, yet the database recovered.

### Failure boundary

Last confirmed successful data-plane request:

- **14:07:34.501 UTC** — `canonical_world_saves`, HTTP 200, 1.961 s.

First confirmed sustained failure:

- **14:15:13.230 UTC** — `canonical_world_saves`, HTTP 522, **90.039 s**.

At 14:16:43 another canonical read returned HTTP 525 after 40.372 s. Thereafter requests settled into repeated ~19–22 second 522 failures.

The first failure coincides with a quarter-hour scheduler boundary. Multiple jobs woke on five- or fifteen-minute boundaries. The logs do not identify which function originated the first canonical read, so no single worker is assigned as the trigger.

### Sustained outage

Repeated failing paths included `canonical_world_saves`, `claim_fixtures_for_engine`, `claim_expired_fixtures_for_submission_lock`, `claim_manager_notification_email_deliveries`, `get_due_external_transfer_settlements`, and Auth `/token` and `/user`.

Scheduled callers continued at regular boundaries throughout 27–28 September. A few Auth requests briefly succeeded on the 28th, but the project remained overwhelmingly unavailable.

### Recovery

1. PR #446 removed known Netlify TOML schedules and disabled the published `scheduled-world-turn` schedule.
2. The Supabase database was restarted.
3. Database/API health was checked before manager login was retried.

Immediately after restart:

- Auth health: HTTP 200 in ~212 ms.
- canonical-world read: HTTP 200 in ~555 ms.
- transfer settlement lookup: HTTP 200 in ~261 ms.
- notification claim: HTTP 200 in ~552 ms.
- PostgreSQL: 16/60 connections; only the diagnostic query active.
- manager password login completed normally and the portal worked.

This strongly supports a database-origin failure rather than an authentication-code root cause.

## Root cause

### Proven

The immediate failure mode was **an unresponsive Supabase database/data-plane origin**. Auth and PostgREST failed together; browser and server callers both received 522s; SQL access timed out; and restart restored Auth, PostgREST and SQL together.

### Likely, not proven

The database most likely entered that state because of **resource exhaustion under concurrent database-heavy work**. The exact resource — RAM, CPU, swap or disk I/O — is unknown.

The 14:07–14:15 load window is the strongest trigger candidate: an expensive canonical checkpoint/release operation was followed by synchronized quarter-hour work. Temporal proximity is not proof that any one operation caused the crash.

### Not supported as root causes

Evidence does not support incorrect credentials, Supabase Auth configuration, the login UI, Performance Observatory, Single Portal State, a general Supabase platform outage as the sole explanation, or player-release settlement alone.

The login diagnostics were nevertheless valuable: they converted a silent hang into `Supabase password sign-in timed out after 12 seconds`.

## Contributing factors

### Synchronized scheduled workloads

Independent jobs wake on the same five- and fifteen-minute boundaries, creating avoidable concurrency.

### Hidden schedule ownership

Schedules exist in both `netlify.toml` and function-level `export const config` declarations. Post-mortem discovery found that PR #446's pause was incomplete. Still-active function-level schedules include:

- `settle-transfers` — every 5 minutes
- `refresh-match-archives` — every 5 minutes
- `manager-notification-email-scheduled` — every 5 minutes
- `refresh-world-read-model` — every 15 minutes
- `manager-inactivity-checkin-scheduled` — hourly
- `manager-inactivity-enforcement-scheduled` — hourly

This explains the successful scheduled traffic observed after restart.

### Large canonical JSON checkpoint

There is one canonical world; its `save_envelope` is approximately **2.20 MB**. Multiple workers read or rewrite it.

### Redundant projection work

`refresh-world-read-model` unconditionally reads the full envelope and rebuilds the read model every 15 minutes. `refresh-match-archives` already refreshes the read model when the checksum changes, and the scheduled world-turn worker also projects archives/read model after a checkpoint.

Cumulative `pg_stat_statements` data ranks this as the largest measured database consumer:

- ~263 read-model refresh RPCs: ~229 s total, ~871 ms mean;
- ~263 paired canonical-world reads: ~132 s total, ~501 ms mean.

### No scheduler health circuit breaker

Workers continue calling Supabase after repeated origin failures. There is no shared health gate to suppress non-essential work after repeated 5xx/522/timeouts.

### Missing application-level timeouts/backoff

Several service wrappers use `fetch()` without an abort timeout. Unhealthy-origin invocations can remain outstanding until infrastructure timeouts and overlap subsequent scheduled runs.

### Duplicate/overlapping invocations

Incident logs frequently show two or three copies of the same scheduled RPC within seconds. Some duplication is explained by multiple workers sharing operations; some may be retries/overlap. Evidence does not justify attributing all duplicates to one mechanism.

### Insufficient outage detection

The database was broken for more than a day before the login symptom led to database-wide diagnosis. There was no independent alert for sustained Auth/PostgREST failure or 522 rate.

### Query/index debt

The Supabase performance advisor reports 63 unindexed foreign keys. This is not established as the trigger; relevant high-traffic relationships should be evaluated with measured query plans rather than indexed indiscriminately.

## Corrective actions

### P0 — before restoring normal schedules

1. Complete the recovery pause by disabling every database-facing function-level schedule.
2. Keep ordinary manager traffic live while establishing a quiet baseline.
3. Add a scheduler inventory test covering TOML and source-level schedules.
4. Add bounded fetch timeouts to scheduled workers.
5. Add a shared circuit-breaker/backoff policy for database-origin failures.
6. Do not restore the old synchronized cron expressions unchanged.

### P1 — scheduler redesign

- Establish one authoritative scheduler registry.
- Stagger jobs so expensive work cannot all start at `:00/:15/:30/:45`.
- Prevent overlap of the same logical job.
- Put cheap health/metadata checks before expensive envelope reads.
- Use exponential backoff with jitter.
- After consecutive database failures, stop non-essential work and emit one operational alert.
- Restore jobs one at a time while measuring latency, connections and query load.

### P1 — projection simplification

- Remove the unconditional 15-minute full-envelope read-model refresher if checksum-driven projection covers its contract.
- Prefer projection immediately after successful canonical checkpoint writes.
- Keep the five-minute archive projector as bounded repair/reconciliation, not a constant full-world projector.
- Continue moving ordinary reads away from `save_envelope`.

### P1 — observability

Alert on sustained 522/525s, Auth/PostgREST health failure, connection saturation, long scheduled invocations, canonical checkpoint/projection p95/p99, and RAM/swap/CPU/I/O pressure.

Record job name/invocation ID, duration, overlap, Supabase request count, envelope reads/writes, status class and timeout count for every scheduled invocation.

### P2 — measured index work

Use `pg_stat_statements`, query plans and the advisor to identify which of the 63 unindexed foreign keys affect real high-volume paths. Add only justified indexes.

## Safe restoration order

1. Complete the full pause and observe ordinary portal traffic.
2. Restore low-cost notification/inactivity jobs with timeouts/circuit breaking.
3. Restore transfer settlement with staggered timing.
4. Restore checksum-driven archive/read-model reconciliation.
5. Restore fixture lock/run processing with non-overlap protection.
6. Restore scheduled world turns last.
7. Observe at least one complete cadence at each stage before adding the next workload.

## Open questions

- What were CPU, RAM, swap and disk-I/O levels at 14:00–14:20 UTC on 26 September?
- What compute size was active?
- Did Netlify retry/concurrently invoke schedules during the trigger window?
- Can the standalone read-model refresher be deleted?
- Which canonical checkpoint operation creates the most write amplification?
- Which unindexed foreign keys occur in high-total-time query plans?

## References

- Supabase: Failed to run SQL query — connection timeout  
  https://supabase.com/docs/guides/troubleshooting/failed-to-run-sql-query-connection-terminated-due-to-connection-timeout
- Supabase: Failed to retrieve tables / 522 and 525 crash symptoms  
  https://supabase.com/docs/guides/troubleshooting/failed-to-retrieve-tables
- Supabase performance tuning  
  https://supabase.com/docs/guides/platform/performance
- Recovery pause: PR #446
