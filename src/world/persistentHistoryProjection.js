const text = (value) => String(value ?? '').trim();
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

function clubName(world, clubId) {
  return text(world.club_profiles?.[clubId]?.club_name) || text(clubId) || 'Unknown club';
}

function playerName(world, playerId) {
  const player = world.squad_cycle?.players?.[playerId];
  return text(player?.display_name || player?.name || player?.player_name) || text(playerId) || 'Unknown player';
}

function orderedTable(table = {}) {
  return Object.values(table).map((row) => ({
    ...row,
    goals_for: number(row.goals_for ?? row.gf),
    goals_against: number(row.goals_against ?? row.ga),
    goal_difference: number(row.goal_difference ?? row.gd)
  })).sort((a, b) => number(b.points) - number(a.points)
    || number(b.goal_difference) - number(a.goal_difference)
    || number(b.goals_for) - number(a.goals_for)
    || text(a.club_id).localeCompare(text(b.club_id)))
    .map((row, index) => ({ position: index + 1, ...row }));
}

function liveDivisions(world, managedClubId) {
  return (world.competition?.divisions || []).map((division) => {
    const runtime = world.matchday_cycle?.runtimes?.[division.division_id] || {};
    return {
      division_id: division.division_id,
      level: division.level,
      name: `Division ${division.level}`,
      standings: orderedTable(runtime.table).map((row) => ({
        ...row,
        club_name: clubName(world, row.club_id),
        is_managed_club: row.club_id === managedClubId
      })),
      played_fixture_count: (runtime.results || []).length,
      scheduled_fixture_count: (runtime.fixtures || []).length
    };
  }).sort((a, b) => a.level - b.level);
}

function parentSeasonId(archive) {
  return text(archive.season_id).replace(/:(?:d|division-)\d+$/, '');
}

function archiveDivisionId(archive) {
  const match = text(archive.season_id).match(/:(d\d+|division-\d+)$/);
  return match?.[1]?.replace('division-', 'd') || null;
}

function decorateAward(world, award) {
  if (!award) return null;
  return {
    ...award,
    club_name: award.club_id ? clubName(world, award.club_id) : null,
    player_name: award.player_id ? playerName(world, award.player_id) : null
  };
}

function decorateResult(world, result) {
  const fixture = result?.fixture || {};
  return {
    fixture_id: fixture.fixture_id,
    matchday: fixture.matchday,
    kickoff_at: fixture.kickoff_at || result.played_at || null,
    home_club_id: fixture.home_club_id,
    away_club_id: fixture.away_club_id,
    home_club_name: clubName(world, fixture.home_club_id),
    away_club_name: clubName(world, fixture.away_club_id),
    home_score: result?.score?.home ?? null,
    away_score: result?.score?.away ?? null,
    report_available: Boolean(result?.fixture && result?.score),
    events: result?.events || [],
    statistics: result?.statistics || result?.stats || null,
    teams: result?.teams || null,
    lineup_state: result?.lineup_state || null
  };
}

function seasonGroups(world) {
  const groups = new Map();
  for (const archive of world.history?.archives || []) {
    const seasonId = parentSeasonId(archive);
    if (!groups.has(seasonId)) groups.set(seasonId, []);
    groups.get(seasonId).push(archive);
  }
  return [...groups.entries()].map(([seasonId, archives]) => {
    const completed = (world.completed_seasons || []).find((row) => row.season_id === seasonId) || null;
    const divisions = archives.map((archive) => {
      const divisionId = archiveDivisionId(archive);
      const level = number(divisionId?.replace('d', ''), 1);
      return {
        archive_id: archive.archive_id,
        division_id: divisionId || 'd1',
        level,
        name: `Division ${level}`,
        archived_at: archive.archived_at,
        summary: {
          ...archive.summary,
          champion_club_name: clubName(world, archive.summary?.champion_club_id)
        },
        standings: (archive.clubs || []).map((row) => ({ ...row, club_name: clubName(world, row.club_id) })),
        awards: Object.fromEntries(Object.entries(archive.awards || {}).map(([key, value]) => [key, decorateAward(world, value)])),
        records: Object.fromEntries(Object.entries(archive.records || {}).map(([key, value]) => [key, decorateAward(world, value)])),
        results: (archive.results || []).map((result) => decorateResult(world, result)),
        legacy_result_count: archive.results ? 0 : (archive.source_fixture_ids || []).length
      };
    }).sort((a, b) => a.level - b.level);
    return {
      season_id: seasonId,
      season_number: number(seasonId.match(/season-(\d+)/)?.[1], 0),
      archived_at: divisions.map((row) => row.archived_at).filter(Boolean).sort().at(-1) || null,
      divisions,
      movement_ids: completed?.movement_ids || []
    };
  }).sort((a, b) => b.season_number - a.season_number || b.season_id.localeCompare(a.season_id));
}

function movementHistory(world) {
  return (world.competition?.movement_history || []).map((row) => ({
    ...row,
    club_name: clubName(world, row.club_id),
    from_division_name: row.from_division_id ? `Division ${text(row.from_division_id).replace(/\D/g, '')}` : null,
    to_division_name: row.to_division_id ? `Division ${text(row.to_division_id).replace(/\D/g, '')}` : null
  })).sort((a, b) => text(b.season_id).localeCompare(text(a.season_id)) || text(a.club_id).localeCompare(text(b.club_id)));
}

function clubHistory(world, clubId, seasons, movements) {
  return {
    club_id: clubId,
    club_name: clubName(world, clubId),
    seasons: seasons.flatMap((season) => season.divisions.flatMap((division) => {
      const row = division.standings.find((standing) => standing.club_id === clubId);
      return row ? [{ season_id: season.season_id, division_id: division.division_id, division_name: division.name, ...row }] : [];
    })),
    movements: movements.filter((row) => row.club_id === clubId),
    honours: seasons.flatMap((season) => season.divisions.flatMap((division) => Object.entries(division.awards)
      .filter(([, award]) => award?.club_id === clubId)
      .map(([award_type, award]) => ({ season_id: season.season_id, division_id: division.division_id, award_type, ...award }))))
  };
}

export function projectPersistentHistory(world, { managedClubId = null } = {}) {
  const seasons = seasonGroups(world);
  const movements = movementHistory(world);
  return {
    world_id: world.world_id,
    current_season_id: world.squad_cycle?.season_id,
    current_season_number: world.season_number,
    live_divisions: liveDivisions(world, managedClubId),
    seasons,
    movement_history: movements,
    managed_club_history: managedClubId ? clubHistory(world, managedClubId, seasons, movements) : null,
    archive_count: world.history?.archives?.length || 0,
    completed_season_count: seasons.length
  };
}
