# Shared component and repository strategy

Status: **adopted**  
Design contract: **tbg-design-contract v1.0.1**  
Governed source: `beautiful-game-manager/public/tbg-design-contract.css`

## Decision

Use a **versioned copied contract** rather than a runtime package or generated remote stylesheet.

The Manager Portal repository is the governed source for the neutral TBG presentation contract. Each application keeps a local copy pinned to an explicit semantic version and Git blob identity. Product-specific selectors and rendering remain inside the consuming repository.

This keeps both Netlify deployments independent: neither application downloads presentation code from the other at build time or runtime, and either application can upgrade or roll back without changing the other.

## Audit of duplicated presentation patterns

The milestone 4 work exposed the same families of presentation behaviour in both products:

| Shared concern | Manager Portal pattern | Pink Final pattern | Contract boundary |
| --- | --- | --- | --- |
| Colour and stock | portal workspace, panels and cards | pink newspaper page and editorial panels | semantic colour/surface tokens |
| Navigation | persistent club navigation and tabs | public section navigation | `.tbg-nav` sizing, active, hover and focus states |
| Panels and cards | dashboard, archive and operational cards | profile, search and editorial cards | `.tbg-panel`, `.tbg-card` |
| Tables | squads, standings and world operations | player, club and research tables | `.tbg-table-wrap`, `.tbg-table`, mobile sticky context |
| Ratings and statuses | rating pills, availability and contract states | ratings, publication and profile statuses | `.tbg-rating`, `.tbg-badge` modifiers |
| Identity links | internal and Pink Final player/club links | player and club profile links | `.tbg-player-link`, `.tbg-club-link` |
| Accessibility | keyboard focus, disabled controls, reduced motion | equivalent public interactions | shared focus and motion rules |

The duplicated concern is semantic presentation, not application rendering. Squad operations, manager controls, newspaper mastheads, profile layouts and data projection remain product code.

## Options considered

### Small shared npm package

Rejected for now. It introduces package publication, registry credentials, dependency updates and build failure modes for a single stylesheet. It also tempts shared rendering components across applications with different permissions and release rhythms.

### Generated or remotely hosted stylesheet

Rejected. A generated remote asset would make one deployment dependent on another source or pipeline and could silently change presentation without a consumer commit.

### Versioned copied contract

Adopted. The copy is intentionally boring: local, reviewable and reversible. Governance is supplied by semantic versioning, a manifest, byte-identity verification and explicit consumer pull requests.

## Repository responsibilities

### `beautiful-game-manager`

- owns the governed neutral contract;
- records the current version and source blob SHA in `design-contract/tbg-design-contract.manifest.json`;
- verifies that contract bytes, version and required primitives agree;
- keeps Manager Portal mappings in product-specific stylesheets.

### `beautiful-game-data`

- receives the contract only through an explicit pull request;
- stores a local byte-for-byte copy at the manifest path;
- records the adopted version and source blob SHA;
- keeps Pink Final editorial selectors and overrides outside the copied contract;
- may remain on an older compatible version while the Manager Portal advances.

### Governance, engine and data boundaries

The contract changes presentation only. It must not define canonical player or club fields, permissions, hidden world state, match behaviour, transfer rules or engine outcomes. Those remain governed by the relevant constitutions and repository contracts.

## Versioning rules

- **Patch:** corrections with no semantic token or primitive change.
- **Minor:** additive tokens, modifiers or primitives; existing consumers remain valid.
- **Major:** rename, removal or changed meaning of a token, class or interaction contract.

Every contract change must update:

1. the CSS version header;
2. the manifest version and source blob SHA;
3. release notes under `docs/design-contract/releases/`;
4. regression tests or the primitive showcase when behaviour changes.

A changed stylesheet with an unchanged manifest fails `npm run design-contract:verify`.

## Upgrade procedure

1. Change the governed CSS in `beautiful-game-manager`.
2. Bump the semantic version and add release notes.
3. Update the manifest blob SHA after the final CSS bytes are settled.
4. Run `npm test` and `npm run design-contract:verify`.
5. Merge and deploy the Manager Portal independently.
6. Open a separate `beautiful-game-data` pull request copying the exact CSS bytes and pinning the same version/blob SHA.
7. Run the Pink Final build, contract verification and primitive visual checks.
8. Merge and deploy Pink Final independently.

A consumer upgrade is never automatic. A new source release therefore cannot silently break an older consumer.

## Rollback procedure

### Manager Portal

Revert the contract release commit together with its manifest and release note, or redeploy the last known-good Netlify build. Product stylesheets can be rolled back separately when the contract itself is unchanged.

### Pink Final

Revert only the consumer adoption pull request or redeploy its previous build. Do not modify or roll back the governed source merely because one consumer needs to retreat.

After rollback, run the local verifier to ensure the stylesheet and manifest again describe the same version and bytes.

## Regression strategy

The contract is protected at three levels:

1. **Integrity:** manifest version and Git blob identity must match the local stylesheet.
2. **Structural regression:** tests require navigation, panels, cards, tables, badges, ratings, identity links, focus and reduced-motion primitives.
3. **Visual review:** `public/design-contract-preview.html` renders the critical primitive matrix for Netlify deploy-preview comparison at compact and desktop widths.

The showcase is not application UI. It is a stable review surface designed to reveal accidental changes to shared primitives before either product adopts a release.

## Acceptance mapping

- one governed source: `public/tbg-design-contract.css` in Manager Portal;
- explicit version: semantic version in CSS, manifest and release notes;
- independent deployments: local copies, no runtime or build-time cross-repository fetch;
- no silent breakage: consumer upgrades require a reviewed pull request and pinned blob identity;
- upgrade and rollback: documented above;
- regression coverage: verifier, node tests and primitive preview.
