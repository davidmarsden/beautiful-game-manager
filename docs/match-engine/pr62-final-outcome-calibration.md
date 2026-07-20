# PR #62 — Final rating-gap, home-advantage and upset-frequency calibration

## Purpose

This increment closes the remaining first-release outcome-calibration work for the constitutional match engine.

It validates four stable scenarios:

- equal 91-rated teams;
- a two-point senior gap (91 v 89);
- a four-point elite-tail gap (95 v 91);
- a ten-point cross-division gap (95 v 85).

Each unequal scenario alternates the stronger side between home and away so rating strength is not confused with venue advantage.

## What is measured

The executable calibration records:

- average goals per match;
- home, away and draw rates;
- the equal-team home-win advantage;
- stronger-team win and non-loss rates;
- upset frequency at each rating gap;
- home and away splits for the stronger side.

## Acceptance policy

The gate requires realistic aggregate scoring, a bounded home effect, visible separation between rating bands and a declining upset curve as the rating gap widens.

Upsets must remain possible at every tested gap. Even a 95-rated side against an 85-rated side cannot become certain to win.

Small deterministic sampling movement is allowed through narrow monotonic tolerances, but a wider rating gap may not materially reduce stronger-team non-loss frequency or materially increase upset frequency.

## Outputs

CI writes:

- `calibration/generated/final-outcome-calibration.json`
- `calibration/generated/final-outcome-calibration.md`

The JSON file is the machine-readable release artifact. The Markdown file is the human review summary.
