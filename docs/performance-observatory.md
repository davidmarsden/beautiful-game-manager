# Performance Observatory

Status: baseline instrumentation for the TBG Fast & Private programme.

## Purpose

Measure the portal before changing its behaviour. This observatory records browser-visible request count, duplicate bootstrap reads, request duration, response bytes, lifecycle milestones and any server timing exposed by TBG endpoints.

It deliberately does **not** send telemetry anywhere. Measurements remain in the manager's browser and can be inspected with `window.tbgPerformance.report()`.

## Baseline journey

Run the same journey before and after each performance change:

1. hard reload while signed in;
2. wait for the dashboard to become usable;
3. open Squad;
4. open Tactics & Team;
5. open Schedule;
6. open Competition;
7. return to Dashboard;
8. run `window.tbgPerformance.report()` in developer tools.

Record:

- time to authorization;
- time to first portal render;
- total same-session API requests;
- number of `/api/bootstrap` requests;
- response bytes;
- slowest requests;
- server timing where available.

## Initial targets

These are engineering targets, not constitutional rules:

- warm in-app navigation should feel immediate and ordinarily complete inside 200 ms;
- ordinary read APIs should ordinarily complete inside 500 ms;
- the authenticated portal should be usable inside 1.5 seconds on a normal broadband connection;
- one page load should require one authoritative bootstrap network read unless a mutation invalidates it;
- no per-player view should create an N+1 fan-out of database RPCs.

## Privacy

Do not record bearer tokens, email addresses, request/response bodies, player or manager identifiers, private messages, tactics or other game state. The observatory records timing, endpoint path, HTTP method/status and byte counts only.

## Next

Once a representative baseline is captured, PR 2 will replace independent bootstrap consumers with one authoritative portal state source rather than attempting to optimise around duplicate reads.
