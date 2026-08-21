const text = (value) => String(value ?? '').trim();
const numericRating = (value) => Number.isFinite(Number(value)) ? Number(value) : null;

function tmId(player = {}) {
  return text(player.transfermarkt_id || player.transfermarktId || player.transfermarkt_player_id);
}

function releaseIds(world = {}) {
  return new Set(Array.isArray(world.player_data_releases?.applied_release_ids)
    ? world.player_data_releases.applied_release_ids.map(text).filter(Boolean)
    : []);
}

function findWorldPlayer(world, event) {
  const players = world?.squad_cycle?.players || {};
  const stableId = text(event?.player_id);
  if (stableId && players[stableId]) return [stableId, players[stableId]];
  const transfermarktId = text(event?.transfermarkt_id);
  if (!transfermarktId) return [null, null];
  return Object.entries(players).find(([, player]) => tmId(player) === transfermarktId) || [null, null];
}

function applyRating(player, rating) {
  player.underlying_ability_rating = rating;
  player.rating = rating;
  player.tbg_rating = rating;
}

export function applyPublishedPlayerReleases(world, history = {}) {
  if (!world?.squad_cycle?.players) throw new Error('Canonical world is missing squad-cycle players');
  const applied = releaseIds(world);
  const releases = Array.isArray(history?.releases) ? [...history.releases] : [];
  releases.sort((left, right) => String(left.published_at || left.slot || '').localeCompare(String(right.published_at || right.slot || '')) || text(left.release_id).localeCompare(text(right.release_id)));

  const summary = { releases_seen: releases.length, releases_applied: [], rating_events_applied: 0, rating_events_missing: [], ignored_events: 0 };
  for (const release of releases) {
    const releaseId = text(release?.release_id);
    if (!releaseId || applied.has(releaseId)) continue;
    for (const event of Array.isArray(release?.events) ? release.events : []) {
      if (event?.event_type !== 'rating_change') {
        summary.ignored_events += 1;
        continue;
      }
      const nextRating = numericRating(event.after);
      if (nextRating === null) throw new Error(`Release ${releaseId} has an invalid rating for ${text(event.player_id) || text(event.transfermarkt_id)}`);
      const [id, player] = findWorldPlayer(world, event);
      if (!player) {
        summary.rating_events_missing.push(text(event.player_id) || `tm:${text(event.transfermarkt_id)}`);
        continue;
      }
      applyRating(player, nextRating);
      summary.rating_events_applied += 1;
      if (!player.tbg_player_id) player.tbg_player_id = id;
    }
    applied.add(releaseId);
    summary.releases_applied.push(releaseId);
  }

  if (summary.releases_applied.length) {
    world.player_data_releases = {
      version: 'tbg-player-data-release-state-v1',
      applied_release_ids: [...applied],
      latest_release_id: summary.releases_applied.at(-1),
      reconciled_at: new Date().toISOString()
    };
  }
  return summary;
}
