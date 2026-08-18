# Multiplayer transfer deal lifecycle

This document records the product boundary exposed by the production transfer-listing and youth-registration findings in August 2026.

The existing `manager_world_commands` bilateral transfer workflow is a minimum command-ledger implementation. It is not the intended long-term multiplayer transfer market.

The target model is a first-class deal lifecycle in which negotiation is immediate, accepted terms become temporarily cancellable for genuine mistakes, then binding before delayed atomic settlement.

## Core lifecycle

`draft/listed → negotiating → agreed → grace_period → binding → settling → completed`

Explicit side outcomes include `countered`, `declined`, `withdrawn`, `mutually_cancelled`, `expired`, `application_failed`, and `reneged`.

## Deal revisions

A negotiation has immutable revisions. Any change to fee, players, loan terms, contract terms or participants creates a new revision and invalidates approvals of earlier revisions. Every affected manager must approve the same final revision.

## Atomic legs

A deal may contain one or more legs:

- cash payment;
- permanent player transfer;
- loan.

All legs validate and settle atomically. This supports player exchanges and multi-club deals without composing independent transfers that can partially apply.

## Agreement protection

Acceptance immediately records the agreed deal sheet. A short unilateral grace period protects against accidental acceptance. After the grace period the deal becomes binding; cancellation requires agreement of all participating clubs or exceptional administrative intervention. Settlement occurs after a configurable delay and is independent of the matchday scheduler.

## Loans

Loan legs may carry duration, fee, wage contribution, recall rules and optional future purchase terms. Ownership remains with the parent club while sporting registration moves temporarily to the borrower.

## World execution

Negotiation state lives outside the canonical matchday command queue. Completed deals settle through a CAS-safe micro-checkpoint against the current canonical checksum. Matchday advancement must not be required merely to list, counter, decline or agree a deal.

## Auditability

The system must preserve the immutable deal sheet, approvals, revisions and terminal reason. It must distinguish withdrawal during negotiation, cancellation during grace, mutual cancellation after binding, failed validation and reneging after binding.
