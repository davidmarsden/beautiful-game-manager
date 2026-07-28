# Shared TBG visual system

Version: **1.0.1**

This contract gives The Pink Final and the Manager Portal one recognisable product language without making them the same application.

## Product roles

- **The Pink Final** remains editorial and public: pink paper, cream panels, heavy newspaper rules, condensed headlines and dense research tables.
- **Manager Portal** remains operational and private: persistent navigation, dashboard cards, filters, selection states, forms and game-workspace density.

The shared layer defines semantic tokens and reusable primitives. Product layers decide how prominently to apply them.

## Files

- `public/tbg-design-contract.css` — versioned tokens and neutral primitives.
- `public/manager-portal-theme.css` — portal mappings and compatibility selectors for the existing interface.
- `public/player-profile.css` — loads both files after the legacy feature styles so the contract can consolidate the current portal without rewriting its rendering code.

## Contract coverage

The contract includes colour and surface tokens, typography, spacing, layout widths, navigation sizing and active states, panels and cards, table states, ratings, availability/status/competition badges, player and club links, responsive table behaviour, visible keyboard focus and reduced-motion support.

## Upgrade rules

1. Additive token or primitive changes are minor releases.
2. Renaming or removing a token is a major release and must be coordinated with The Pink Final.
3. Each repository keeps a local versioned copy until milestone 5 decides the governed distribution mechanism.
4. Product-specific selectors belong in the product theme, not the shared contract.
5. A repository can roll back independently by reverting its contract and theme commits together.

## Pink Final adoption

Milestone 5 should copy `tbg-design-contract.css` at version 1.0.1 into `beautiful-game-data`, map its existing Pink Final selectors to the shared primitives, and retain the more overt newspaper masthead and editorial layout. The shared semantic names—not byte-for-byte identical pages—are the compatibility boundary.
