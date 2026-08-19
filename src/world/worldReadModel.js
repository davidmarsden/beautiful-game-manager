const clone = (value) => JSON.parse(JSON.stringify(value ?? null));

function compactRuntime(runtime = {}) {
  return {
    fixtures: clone(runtime.fixtures || []),
    table: clone(runtime.table || {}),
    archive_results: clone(runtime.archive_results || []),
    results: clone(runtime.results || [])
  };
}

/**
 * Build the manager-facing World/history read model.
 *
 * The canonical save is the authoritative write/checkpoint envelope and contains
 * substantially more operational state than History, Competition and archived
 * Match Centre navigation require. Runtime player/availability state is deliberately
 * omitted here: it duplicates the canonical squad/player universe and was making a
 * post-settlement read-model refresh almost as large as the canonical save itself.
 */
export function buildWorldReadModel(world = {}) {
  const runtimes = Object.fromEntries(Object.entries(world.matchday_cycle?.runtimes || {})
    .map(([divisionId, runtime]) => [divisionId, compactRuntime(runtime)]));

  return {
    world_id: world.world_id || null,
    display_name: world.display_name || null,
    season_number: world.season_number ?? null,
    phase: world.phase || null,
    clock: clone(world.clock || null),
    club_profiles: clone(world.club_profiles || {}),
    competition: {
      divisions: clone(world.competition?.divisions || []),
      movement_history: clone(world.competition?.movement_history || [])
    },
    squad_cycle: {
      season_id: world.squad_cycle?.season_id || null,
      registration_limit: world.squad_cycle?.registration_limit ?? null,
      squad_limits: clone(world.squad_cycle?.squad_limits || { first_team: 25, youth: 25 }),
      clubs: clone(world.squad_cycle?.clubs || {}),
      players: clone(world.squad_cycle?.players || {}),
      contracts: clone(world.squad_cycle?.contracts || {}),
      state: {
        registrations: clone(world.squad_cycle?.state?.registrations || world.squad_cycle?.registrations || {})
      }
    },
    matchday_cycle: {
      season_id: world.matchday_cycle?.season_id || null,
      current_matchday: world.matchday_cycle?.current_matchday ?? null,
      maximum_matchday: world.matchday_cycle?.maximum_matchday ?? null,
      turn_calendar: clone(world.matchday_cycle?.turn_calendar || {}),
      runtimes
    },
    history: {
      archives: clone(world.history?.archives || [])
    },
    completed_seasons: clone(world.completed_seasons || [])
  };
}
