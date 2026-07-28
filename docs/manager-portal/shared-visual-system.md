# Shared TBG visual system

Version: **1.0.1**

This contract gives The Pink Final and the Manager Portal one recognisable product language without making them the same application.

## Product roles

- **The Pink Final** remains editorial and public: pink paper, cream panels, heavy newspaper rules, condensed headlines and dense research tables.
- **Manager Portal** remains operational and private: persistent navigation, dashboard cards, filters, selection states, forms and game-workspace density.

The shared layer defines semantic tokens and reusable primitives. Product layers decide how prominently to apply them.

## Files

- `public/tbg-design-contract.css` — governed, versioned tokens and neutral primitives.
- `design-contract/tbg-design-contract.manifest.json` — semantic version, source identity and consumer paths.
- `public/manager-portal-theme.css` — portal mappings and compatibility selectors for the existing interface.
- `public/player-profile.css` — loads both files after the legacy feature styles so the contract can consolidate the current portal without rewriting its rendering code.
- `public/design-contract-preview.html` — stable visual-review surface for critical primitives.

## Contract coverage

The contract includes colour and surface tokens, typography, spacing, layout widths, navigation sizing and active states, panels and cards, table states, ratings, availability/status/competition badges, player and club links, responsive table behaviour, visible keyboard focus and reduced-motion support.

## Upgrade rules

1. Presentation fixes without semantic change are patch releases.
2. Additive token or primitive changes are minor releases.
3. Renaming, removing or changing the meaning of a token or primitive is a major release.
4. Each repository keeps a local versioned copy pinned to the governed source blob identity.
5. Product-specific selectors belong in the product theme, not the shared contract.
6. Consumer upgrades happen through explicit pull requests and never through remote runtime or build-time imports.
7. A repository can roll back independently by reverting its own adoption commit or redeploying its previous build.

Full governance, audit, upgrade and rollback procedure: [`shared-component-repository-strategy.md`](./shared-component-repository-strategy.md).

## Pink Final adoption

`beautiful-game-data` should copy the exact `tbg-design-contract.css` v1.0.1 bytes into its manifest path, pin the same version and source blob SHA, map existing Pink Final selectors to the shared primitives, and retain the more overt newspaper masthead and editorial layout. The copied contract bytes are the governed compatibility baseline; product pages and rendering remain intentionally different.
