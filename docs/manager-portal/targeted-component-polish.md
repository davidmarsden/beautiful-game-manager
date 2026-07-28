# Targeted Manager Portal component polish

This follow-up applies the Football Pink product language to legacy feature components that still overrode the shared visual contract after PRs #143–#145.

## Migrated clusters

- **Tactics & Team:** formation workspace, squad rail, bench slots and supporting controls use pink-paper surfaces. The green pitch, dark tactical player slots and semantic warnings remain unchanged.
- **Competition matchdays:** round headers, navigation, fixture rows, score controls and archive surfaces use the pink/black/cream system. Managed fixtures retain their yellow highlight.
- **World:** summary cards, operational request panels, forms and bulk-registration rows use pink stock while controls remain clearly differentiated.
- **Dashboard inbox:** read and unread messages use distinct pink-paper states instead of white slabs.
- **Late-loaded legacy panels:** known Schedule and History card surfaces are remapped only within their product views.

## Boundary

The patch does not change the shared contract or deepen global palette tokens. Every rule is scoped to a component cluster under its view ID. Match Centre keeps its teletext identity, status colours remain semantic, and the Manager Portal remains operationally distinct from The Pink Final.

## Visual regression surface

`public/targeted-component-polish-preview.html` provides one stable deploy-preview page containing representative Tactics, Competition, World and Inbox clusters for screenshot comparison at desktop and mobile widths.

## Rollback

The entire refinement is isolated in `public/targeted-component-polish.css`, loaded last after `football-pink-stock.css`. Remove that single stylesheet link, or revert the patch commits together, to return to the milestone-4 presentation without altering the governed shared contract.
