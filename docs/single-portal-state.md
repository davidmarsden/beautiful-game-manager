# Single Portal State migration

The manager portal is moving from independent bootstrap consumers to one generation-scoped state authority.

## Compatibility rule

`window.tbgPortalState` is a legacy state-object global used by formation and submission modules. Do not repurpose it. The state service is `window.tbgPortalStateStore`.

The store exposes:

- `get()` — return the current state, sharing an in-flight read when necessary;
- `peek()` — synchronously inspect state already owned by the store;
- `invalidate()` — invalidate state and the compatible bootstrap response cache;
- `refresh()` — invalidate and obtain fresh canonical state.

Existing calls to `fetch('/api/bootstrap')` remain supported while consumers are migrated. The response cache still deduplicates those calls.

## First consumer

`team-presets.js` now uses the store. Its fixed 900 ms startup delay and 1400 ms post-submit refresh delay have been removed. After a team submission it consumes the canonical state emitted by the reliable submission controller, falling back to the shared store only when that state is unavailable.

## Migration rule

Move one consumer at a time. Do not remove the compatible fetch interception until repository search shows no independent bootstrap consumers and the submission/formation regression suite remains green.
