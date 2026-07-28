# TBG data and privacy contract

Status: **governed integration boundary**  
Roadmap: `beautiful-game-manager#123`, milestone 6

## Product boundary

The Beautiful Game Manager Portal is an authenticated view of the live canonical world. The Pink Final is a public real-world player and club database. Shared identity and navigation do not make their data permissions interchangeable.

The constitutional rule is simple: public systems may describe public facts, but they must never know more than the public is allowed to know. Manager attention, submissions, commands and unresolved outcomes remain private until the canonical world publishes their effects.

## Public canonical player fields

Pink Final player projections may contain only stable identity and public football facts:

- durable player identity and governed Pink Final route key;
- display/canonical name;
- date of birth or age;
- nationality/country;
- public position labels;
- current TBG ability rating and official public potential band;
- governed publication status and public profile URL;
- real-world source profile URL where publication policy permits it.

They must not contain live fantasy-club ownership, fitness, morale, availability, contract workflow state, private scouting notes, true potential, exact preference weights, transfer negotiations or manager activity.

## Public canonical club fields

Pink Final club projections may contain only:

- durable club identity and governed Pink Final route key;
- canonical/display name;
- country, city, founding year and crest;
- governed publication status and public profile URL.

Current TBG division, league position, manager, appointment, squad, finances, board state and live competition state are not part of the public club projection.

## Manager-visible live-world fields

After authentication, managers may inspect canonical live-world information permitted by the portal, including squads, division and league context, published fixtures and revealed results, player fitness, morale, availability, contract/status information, and public board objectives/confidence.

Visibility is not edit authority. Appointment-scoped commands and submissions remain writable only for the manager's active appointment. Other clubs are read-only.

## Never-public state

The following must never enter Pink Final or another unauthenticated projection:

- world/save identifiers and checksums;
- manager email, manager ID, appointment ID or access tokens;
- team sheets, tactical submissions, private submissions or command queues;
- sealed bids, private shortlists, scouting notes or negotiation internals;
- exact hidden potential/preference values;
- simulation seeds;
- pending, unrevealed or embargoed match results.

A revealed outcome may later be published through a deliberately public history/records projection. Its private precursor must not be exposed.

## Endpoint rules

- Public endpoints must build responses with explicit allow-list projectors from `src/privacy/dataPrivacyContract.js`.
- Appointment-scoped endpoints must require a bearer-authenticated manager and verify the active appointment before reading or applying commands.
- Canonical-world read endpoints remain authenticated and use `Cache-Control: no-store` unless a separately governed public projection is introduced.
- A public UI must never call a protected endpoint and relay its response into Pink Final.
- Public and protected payloads must not share a permissive `...world` or `...player` spread at the boundary.

## Profile URL rules

Public player and club URLs carry only an immutable public route key. They must not include world, save, manager, appointment, season, squad, fixture, match or result scope. Display names, divisions and live ownership are never route keys.

An explicit profile URL is accepted only when it uses HTTP(S), contains no embedded credentials and has no forbidden live-world query parameter. Generated routes discard existing query strings and fragments before adding the stable `id`.

A published URL proves only that a public identity exists. It must not reveal whether that identity is in a particular TBG world, squad, fixture, transfer process or manager appointment.

## Repository responsibilities

- `beautiful-game-manager` owns authenticated live-world projections, command protection and the executable boundary tests.
- `beautiful-game-data` owns Pink Final public publication and must consume only allow-listed public fields; it must not import canonical save files.
- `beautiful-game-engine` owns deterministic state and revelation timing; unrevealed outcomes remain internal engine/world state.
- `beautiful-game-governance` defines which football facts, uncertainty bands and outcomes are public or hidden. Code may narrow exposure for safety but must not silently broaden it.

## Change control

Adding a public field requires all of:

1. a constitutional/publication basis;
2. an explicit allow-list change;
3. a projection-boundary test;
4. confirmation that the field cannot reveal unrevealed results, private manager behaviour or appointment scope;
5. a coordinated Pink Final consumer change.

A convenient field is not automatically a public field.
