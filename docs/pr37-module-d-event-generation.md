# PR #37 — Module D: Match Event Generation

## Purpose

This PR replaces Module D's no-op with a deterministic expected-performance and provisional event-generation layer. It consumes the tactical matchup from Module A, player and unit quality from Module B, and match-layer context from Module C.

It still does not publish the constitutional match result. Module E remains responsible for accepting the generated stream, resolving the official score and enforcing score/event consistency.

## Expected performance

For each side Module D derives:

- attack, midfield and opposing defensive line strengths;
- midfield control share;
- tempo and tactical factors;
- attack share;
- expected chances;
- expected conversion rate;
- expected goals;
- expected set pieces and cards.

Expected goals are bounded between `0.15` and `3.80` per side at this scaffold stage. All coefficients remain calibration dials.

## Deterministic event stream

The fixture identity, season, round, date and run key form a private deterministic seed input. Module D stores only a seed commitment internally at this stage. The generated provisional stream includes:

- shots and big chances;
- provisional goal events;
- corners and free kicks;
- penalties;
- yellow and red cards;
- fatigue-linked injury hooks;
- commentary hooks for Module F.

The same inputs produce the same stream. A changed fixture seed produces a different stream. There is no hidden or unseeded randomness.

## Architectural boundary

The stream and provisional score are deliberately labelled provisional:

- `score_resolution_pending: true`;
- `state_updates_projected_only: true`;
- `applied_to_public_result: false`.

Module E will own the official result, consistency checks, final seed publication and state-write decisions. Module F will turn the event hooks into the public commentary and report.

## Compatibility

The existing compatibility runner remains the only producer of the public result contract. Scores, events, commentary, Match Centre payloads and golden fingerprints remain unchanged.

No migration required.
