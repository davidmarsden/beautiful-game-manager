import { clubFinanceReadModel } from '../squadCycle/clubFinance.js';

const clone = (value) => JSON.parse(JSON.stringify(value ?? null));

function compactRuntimePlayerState(player = {}) {
  return {
    fitness: player.fitness ?? null,
    morale: player.morale ?? null
  };
}

function compactRuntimeAvailability(player = {}) {
  return {
    injury_until_matchday: player.injury_until_matchday ?? null,
    suspension_until_matchday: player.suspension_until_matchday ?? null
  };
}

function compactRuntime(runtime = {}) {
  return {
    fixtures: clone(runtime.fixtures || []),
    table: clone(runtime.table || {}),
    archive_results: clone(runtime.archive_results || []),
    results: clone(runtime.results || []),
    state: {
      players: Object.fromEntries(Object.entries(runtime.state?.players || {})
        .map(([playerId, player]) => [playerId, compactRuntimePlayerState(player)])),
      availability: {
        players: Object.fromEntries(Object.entries(runtime.state?.availability?.players || {})
          .map(([playerId, player]) => [playerId, compactRuntimeAvailability(player)]))
      }
    }
  };
}

function compactPlayer(player = {}, playerId = null) {
  return {
    tbg_player_id: player.tbg_player_id || player.player_id || player.id || playerId,
    player_id: player.player_id || player.tbg_player_id || player.id || playerId,
    transfermarkt_id: player.transfermarkt_id || player.transfermarktId || player.transfermarkt_player_id || null,
    display_name: player.display_name || player.player_name || player.full_name || player.name || playerId,
    player_name: player.player_name || player.display_name || player.full_name || player.name || playerId,
    club_id: player.club_id || player.tbg_club_id || player.current_club_id || null,
    age: player.age ?? null,
    season_start_age: player.season_start_age ?? null,
    youth_eligible_at_season_start: player.youth_eligible_at_season_start,
    squad_registration: player.squad_registration || player.registration_group || player.squad_status || null,
    specific_position: player.specific_position || player.position || player.primary_position || player.position_group || null,
    position: player.position || player.specific_position || player.primary_position || player.position_group || null,
    position_group: player.position_group || null,
    underlying_ability_rating: player.underlying_ability_rating ?? player.tbg_rating ?? player.rating ?? null,
    rating: player.rating ?? player.underlying_ability_rating ?? player.tbg_rating ?? null,
    contract_id: player.contract_id || null,
    squad_number: player.squad_number ?? null,
    morale: player.morale || null,
    registered: player.registered,
    transfer_listed: Boolean(player.transfer_listed),
    loan_listed: Boolean(player.loan_listed),
    loaned_out: Boolean(player.loaned_out),
    loan_status: player.loan_status || null,
    loan_club_name: player.loan_club_name || null,
    profile_url: player.profile_url || null,
    source_profile_url: player.source_profile_url || null,
    pink_final_profile_url: player.pink_final_profile_url || null,
    public_profile_url: player.public_profile_url || null,
    pink_final_route_key: player.pink_final_route_key || null,
    profile_route_key: player.profile_route_key || null,
    canonical_profile_key: player.canonical_profile_key || null,
    profile_published: player.profile_published,
    pink_final_profile_published: player.pink_final_profile_published,
    public_profile_published: player.public_profile_published,
    publication_status: player.publication_status || null,
    profile_status: player.profile_status || null,
    synthetic: Boolean(player.synthetic || player.generated || player.generated_youth || player.academy_generated),
    generated: Boolean(player.generated),
    generated_youth: Boolean(player.generated_youth),
    academy_generated: Boolean(player.academy_generated),
    generation_source: player.generation_source || player.player_source || player.source || player.origin || null
  };
}

function compactContract(contract = {}, contractId = null) {
  return {
    contract_id: contract.contract_id || contractId,
    player_id: contract.player_id || null,
    club_id: contract.club_id || null,
    end_at: contract.end_at || null,
    wage: contract.wage ?? null,
    status: contract.status || null,
    squad_registration: contract.squad_registration || null
  };
}

function compactObjectMap(source = {}, mapper) {
  return Object.fromEntries(Object.entries(source || {}).map(([key, value]) => [key, mapper(value, key)]));
}

/**
 * Build the manager-facing World/history read model.
 *
 * The canonical save is the authoritative write/checkpoint envelope. This cache is
 * deliberately a read projection, not a second copy of the world. Only the runtime
 * player condition/availability fields consumed by History and the manager portal
 * are retained; heavyweight scouting/engine metadata and unrelated runtime state are
 * excluded so transfer settlement does not turn reads into checkpoint-sized payloads.
 */
export function buildWorldReadModel(world = {}) {
  const runtimes = Object.fromEntries(Object.entries(world.matchday_cycle?.runtimes || {})
    .map(([divisionId, runtime]) => [divisionId, compactRuntime(runtime)]));
  const players = compactObjectMap(world.squad_cycle?.players || {}, compactPlayer);
  const contracts = compactObjectMap(world.squad_cycle?.contracts || {}, compactContract);
  const finances = world.squad_cycle ? clubFinanceReadModel(world.squad_cycle) : {};

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
      players,
      contracts,
      finances,
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
