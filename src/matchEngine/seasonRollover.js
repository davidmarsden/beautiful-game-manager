const round = (value, places = 4) => Number(Number(value).toFixed(places));
const unique = (values) => new Set(values).size === values.length;

export const SEASON_ROLLOVER_VERSION = 'tbg-season-rollover-v1.2';

function averageStartingRating(clubs) {
  const ratings = clubs.flatMap((club) => club.players.slice(0, 11).map((player) => Number(player.underlying_ability_rating)));
  return round(ratings.reduce((sum, rating) => sum + rating, 0) / Math.max(1, ratings.length), 3);
}

function orderedDivisions(divisions) {
  if (!Array.isArray(divisions) || divisions.length < 2) return null;
  const ordered = [...divisions].sort((a, b) => a.level - b.level);
  const valid = ordered.every((division, index) => (
    division.level === index + 1
    && division.division_id === `d${index + 1}`
    && Array.isArray(division.clubs)
  ));
  return valid ? ordered : null;
}

function standingsByDivision(completedReport) {
  return new Map((completedReport?.divisions || []).map((division) => [division.division_id, division.standings]));
}

function reportMatchesDivisions(completedReport, ordered) {
  if (!Array.isArray(completedReport?.divisions)) return false;
  const suppliedIds = ordered.map((division) => division.division_id).sort();
  const reportIds = completedReport.divisions.map((division) => division.division_id).sort();
  return unique(reportIds)
    && suppliedIds.length === reportIds.length
    && JSON.stringify(suppliedIds) === JSON.stringify(reportIds);
}

export function rollOverPlayableLeague({
  divisions,
  completedReport,
  movementCount = 1,
  nextSeasonId = `${completedReport?.season_id || 'season'}-next`
} = {}) {
  const ordered = orderedDivisions(divisions);
  if (!ordered) throw new Error('Season rollover requires contiguous divisions d1 through dN');
  if (!completedReport?.accepted) throw new Error('Season rollover requires an accepted completed league report');
  if (!reportMatchesDivisions(completedReport, ordered)) throw new Error('Season rollover report divisions do not match supplied divisions');
  if (!Number.isInteger(movementCount) || movementCount < 1) throw new Error('movementCount must be a positive integer');

  const standingsMap = standingsByDivision(completedReport);
  const clubsByDivision = new Map(ordered.map((division) => [division.division_id, new Map(division.clubs.map((club) => [club.club_id, club]))]));
  const promoted = new Map();
  const relegated = new Map();

  for (const division of ordered) {
    const standings = standingsMap.get(division.division_id);
    if (!Array.isArray(standings) || standings.length !== division.clubs.length) {
      throw new Error(`Season rollover standings do not reconcile for ${division.division_id}`);
    }
    if (movementCount * 2 >= division.clubs.length) throw new Error(`movementCount is too large for ${division.division_id}`);
    const standingIds = standings.map((row) => row.club_id);
    if (!unique(standingIds) || standingIds.some((id) => !clubsByDivision.get(division.division_id).has(id))) {
      throw new Error(`Season rollover standings contain invalid clubs for ${division.division_id}`);
    }
    promoted.set(division.division_id, standings.slice(0, movementCount).map((row) => row.club_id));
    relegated.set(division.division_id, standings.slice(-movementCount).map((row) => row.club_id));
  }

  const movements = [];
  const nextDivisions = ordered.map((division, index) => {
    const retained = division.clubs.filter((club) => {
      if (index > 0 && promoted.get(division.division_id).includes(club.club_id)) return false;
      if (index < ordered.length - 1 && relegated.get(division.division_id).includes(club.club_id)) return false;
      return true;
    });
    const incomingPromoted = index < ordered.length - 1
      ? promoted.get(ordered[index + 1].division_id).map((id) => clubsByDivision.get(ordered[index + 1].division_id).get(id))
      : [];
    const incomingRelegated = index > 0
      ? relegated.get(ordered[index - 1].division_id).map((id) => clubsByDivision.get(ordered[index - 1].division_id).get(id))
      : [];

    for (const club of incomingPromoted) movements.push(Object.freeze({ club_id: club.club_id, from_division_id: ordered[index + 1].division_id, to_division_id: division.division_id, movement: 'promoted' }));
    for (const club of incomingRelegated) movements.push(Object.freeze({ club_id: club.club_id, from_division_id: ordered[index - 1].division_id, to_division_id: division.division_id, movement: 'relegated' }));

    const clubs = Object.freeze([...retained, ...incomingPromoted, ...incomingRelegated].sort((a, b) => a.club_id.localeCompare(b.club_id)));
    return Object.freeze({ ...division, club_count: clubs.length, average_starting_rating: averageStartingRating(clubs), clubs });
  });

  const originalClubIds = ordered.flatMap((division) => division.clubs.map((club) => club.club_id)).sort();
  const nextClubIds = nextDivisions.flatMap((division) => division.clubs.map((club) => club.club_id)).sort();
  const checks = Object.freeze({
    contiguous_division_set_preserved: Boolean(orderedDivisions(nextDivisions)),
    report_divisions_match_supplied_divisions: reportMatchesDivisions(completedReport, ordered),
    every_division_keeps_its_size: nextDivisions.every((division, index) => division.club_count === ordered[index].club_count),
    every_club_preserved_once: unique(nextClubIds) && JSON.stringify(nextClubIds) === JSON.stringify(originalClubIds),
    expected_movement_count: movements.length === movementCount * 2 * (ordered.length - 1),
    top_and_bottom_divisions_have_one_way_movement: movements.filter((row) => row.to_division_id === 'd1' && row.movement === 'promoted').length === movementCount
      && movements.filter((row) => row.to_division_id === `d${ordered.length}` && row.movement === 'relegated').length === movementCount
  });

  return Object.freeze({
    version: SEASON_ROLLOVER_VERSION,
    completed_season_id: completedReport.season_id,
    next_season_id: nextSeasonId,
    movement_count_per_boundary: movementCount,
    movements: Object.freeze(movements),
    divisions: Object.freeze(nextDivisions),
    checks,
    accepted: Object.values(checks).every(Boolean)
  });
}
