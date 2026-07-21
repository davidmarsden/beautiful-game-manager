# First usable tablet-first manager portal

Version: `tbg-manager-portal-v1.0`

This slice turns the existing authenticated manager interface into a practical club workspace without replacing the validated decision-submission flow.

## Dashboard

The dashboard now presents, at a glance:

- current league position and points when standings are available;
- completed fixtures and season progress;
- registered and currently available squad counts;
- the next opponent and whether a team has been submitted;
- prioritised club actions linking directly to the relevant workspace.

## Squad intelligence

The squad page derives the same broad planning groups used by squad intelligence while preserving the player’s specific Transfermarkt-style position:

- goalkeeper;
- defender;
- midfielder;
- attacker.

It shows registered and available cover against the playable minimum, highlights structural and temporary gaps, and lists contracts expiring within twelve months.

## Existing validated actions

The portal continues to use the existing authenticated bootstrap and decision APIs. Team selection, bench, formation and tactical choices still pass through the same server-side submission contract; the new overview is advisory and does not bypass domain validation.

## Season and history

Schedule and competition workspaces now include season-progress and archive placeholders. When the bootstrap contract exposes a season archive, the portal shows only awards that actually exist. Null Golden Boot or assist-leader values remain absent rather than becoming zero-value winners.

## Delivery boundary

This is the first usable portal shell, not the complete persistent-world UI. Transfer actions, contract negotiations, world save/load controls and offseason advancement remain subsequent Road to Playable Persistent World milestones.

## Responsive contract

The overview uses four-column desktop/tablet cards, collapses to two columns on narrow tablets and one column on phones. Navigation remains horizontally scrollable and the top bar stays accessible on small screens.
