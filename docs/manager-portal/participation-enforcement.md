# Controlled-alpha participation enforcement

The controlled alpha now enforces a fixed, published participation ladder for human club appointments:

| Inactivity | Stage | Effect |
| --- | --- | --- |
| 3 days | Warning / check-in | Existing friendly participation email and in-app action-required notification. The club remains fully assigned to the manager. |
| 7 days | Caretaker status | The appointment remains recoverable, but the club is marked as being in caretaker status. A dedicated email and in-app notification are sent. Returning to the Manager Portal clears caretaker status immediately. |
| 10 days | Removal | The human appointment is ended automatically, the club becomes available for replacement, and the tester invite returns to the reappointment pool. The removal is audit-logged and a dedicated email is sent. |

These values are **operational dials** under Manager Career, Participation & Governance Constitution Part 6. The structural rule is fixed: **Warning → Caretaker Status → Removal**, with published thresholds and deterministic enforcement.

## Activity episode

The current alpha uses the existing world-scoped Manager Portal activity anchor. A new activity event starts a fresh inactivity episode. Escalation rows are keyed by appointment, activity anchor and stage so a manager receives each stage at most once per episode.

The hard stages only run after the 3-day check-in for that same activity episode has been successfully sent. This prevents a manager being removed without the first warning having been delivered.

## Recovery

At 7 days the human appointment remains active. A portal activity touch updates the world-scoped activity anchor and deletes the current caretaker state immediately. The manager therefore recovers without administrator intervention provided the 10-day removal threshold has not been crossed.

At 10 days removal is involuntary and deterministic. The appointment is marked `ended`, the club becomes unappointed, and the tester is placed in the existing reappointment pool. Manager profile and career history are not deleted.

## Continuity

This alpha implementation does not create the future full constitutional caretaker-manager entity. Matchday continuity continues to use the existing deterministic fallback for human clubs that miss a deadline and, where enabled, the alpha simulation-manager path for clubs with no human appointment.

That is deliberately an alpha implementation boundary. The permanent system still needs obligation-based Professionalism and Away Mode, because the Information Constitution explicitly says logins are not the long-term participation measure.

## Operations

- `manager-inactivity-checkin-scheduled.mjs` runs hourly at minute 15 and owns the 3-day first warning.
- `manager-inactivity-enforcement-scheduled.mjs` runs hourly at minute 30 and owns the 7-day and 10-day hard stages.
- Both workers use bounded email retries.
- Stage transitions are idempotent and auditable.
