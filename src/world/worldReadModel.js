const clone = (value) => JSON.parse(JSON.stringify(value ?? null));

function compactRuntime(runtime = {}) {
  return {
    fixtures: clone(runtime.fixtures || []),
    table: clone(runtime.table || {}),
    archive_results: clone(runtime.archive_results || []),
    results: clone(runtime.results || []),
    state: {
      players: clone(runtime.state?.players || {}),
      availability: {
        players: clone(runtime.state?.availability?.players || {})
      },
      applied_run_keys: clone(runtime.state?.applied_run_keys || [])
    }
  };
}

/**
 * Build the manager-facing World/history read model.
 *
 * The canonical save is the authoritative write/checkpoint envelope and contains
 * substantially more operational state than History, Competition and archived
 * Match Centre navigation require. This projection is intentionally world-shaped
 * so existing read-only projection helpers can consume it without reopening the
 * full canonical envelope on every page request.
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
      clubs: clone(world.squad_cycle?.clubs || {}),
      players: clone(world.squad_cycle?.players || {}),
      contracts: clone(world.squad_cycle?.contracts || {}),
      state: {
        registrations: clone(world.squad_cycle?.state?.registrations || {})
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
