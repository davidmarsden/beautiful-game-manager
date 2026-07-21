import { createHash } from 'node:crypto';
import { syntheticSeasonClubs } from '../matchEngine/seasonSimulation.js';
import {
  createPersistentWorld,
  runPersistentWorldSeasons,
  savePersistentWorld,
  validatePersistentWorld
} from '../world/persistentSeasonLoop.js';

export const PLAYABLE_WORLD_RC_VERSION = 'tbg-playable-world-release-candidate-v1.0';
export const DEFAULT_PLAYABLE_WORLD_SOAK_SEASONS = 12;

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

function worldOptions({ worldId, clubCount, baseRating, humanClubId }) {
  const clubs = syntheticSeasonClubs({ clubCount, baseRating });
  return {
    worldId,
    clubs,
    humanClubId: humanClubId || clubs[0]?.club_id
  };
}

function runSoak({ seasons, worldId, clubCount, baseRating, humanClubId, defaultInstruction }) {
  const world = createPersistentWorld(worldOptions({ worldId, clubCount, baseRating, humanClubId }));
  return runPersistentWorldSeasons({ seasons, world, defaultInstruction });
}

function seasonChecks(run) {
  return run.reports.every((report) => report.accepted && Object.values(report.checks).every(Boolean));
}

function archiveIds(run) {
  return run.final_world.history.archives.map((row) => row.archive_id);
}

function playerIds(world) {
  return Object.keys(world.squad_cycle.players);
}

function activeOwnedPlayers(world) {
  return Object.values(world.squad_cycle.players).filter((player) => player.club_id);
}

function saveEvidence(world) {
  const serialized = savePersistentWorld(world);
  return Object.freeze({
    bytes: Buffer.byteLength(serialized, 'utf8'),
    sha256: hash(serialized),
    serialized
  });
}

export function buildPlayableWorldReleaseCandidate({
  seasons = DEFAULT_PLAYABLE_WORLD_SOAK_SEASONS,
  clubCount = 4,
  baseRating = 86,
  worldId = 'playable-world-rc',
  humanClubId,
  defaultInstruction = {
    formation: '4-3-3-wide',
    tactics: {
      style: 'possession',
      route_to_goal: 'wide',
      pressing: 'mid',
      tempo: 'normal',
      mentality: 'positive'
    }
  }
} = {}) {
  if (!Number.isInteger(seasons) || seasons < 2) throw new Error('Playable-world RC requires at least two soak seasons');

  const first = runSoak({ seasons, worldId, clubCount, baseRating, humanClubId, defaultInstruction });
  const second = runSoak({ seasons, worldId, clubCount, baseRating, humanClubId, defaultInstruction });

  const splitAt = Math.max(1, Math.floor(seasons / 2));
  const initial = createPersistentWorld(worldOptions({ worldId, clubCount, baseRating, humanClubId }));
  const firstHalf = runPersistentWorldSeasons({ seasons: splitAt, world: initial, defaultInstruction });
  const resumed = runPersistentWorldSeasons({
    seasons: seasons - splitAt,
    world: firstHalf.final_world,
    defaultInstruction
  });

  const firstSave = saveEvidence(first.final_world);
  const secondSave = saveEvidence(second.final_world);
  const resumedSave = saveEvidence(resumed.final_world);
  const finalWorld = first.final_world;
  const ids = playerIds(finalWorld);
  const owned = activeOwnedPlayers(finalWorld);
  const archiveList = archiveIds(first);

  const checks = Object.freeze({
    primary_soak_accepted: first.accepted,
    repeated_soak_accepted: second.accepted,
    every_primary_season_accepted: seasonChecks(first),
    every_repeated_season_accepted: seasonChecks(second),
    deterministic_full_run: firstSave.sha256 === secondSave.sha256,
    resumed_run_matches_continuous_run: firstSave.sha256 === resumedSave.sha256,
    archive_count_matches_seasons: archiveList.length === seasons,
    archive_ids_are_unique: new Set(archiveList).size === archiveList.length,
    completed_seasons_match_archives: finalWorld.completed_seasons.length === archiveList.length,
    final_world_is_valid: validatePersistentWorld(finalWorld).valid,
    final_world_returns_to_preseason: finalWorld.phase === 'preseason',
    season_number_advanced_exactly: finalWorld.season_number === seasons + 1,
    all_final_squads_viable: first.checks.final_squads_viable,
    player_ids_are_unique: new Set(ids).size === ids.length,
    every_owned_player_has_active_contract: owned.every((player) => {
      const contract = finalWorld.squad_cycle.contracts[player.contract_id];
      return contract?.status === 'active' && contract.player_id === player.tbg_player_id && contract.club_id === player.club_id;
    }),
    world_event_ids_are_unique: new Set(finalWorld.event_ledger.map((row) => row.event_id)).size === finalWorld.event_ledger.length,
    squad_cycle_event_ids_are_unique: new Set(finalWorld.squad_cycle.events.map((row) => row.event_id)).size === finalWorld.squad_cycle.events.length,
    save_is_nonempty: firstSave.bytes > 0,
    every_season_has_human_decisions: first.reports.every((row) => row.season.decisions.length === row.season.onboarding.required_decisions),
    every_season_manages_all_ai_clubs: first.reports.every((row) => (
      row.ai_preseason.length === clubCount - 1 && row.ai_next_preseason.length === clubCount - 1
    ))
  });

  return Object.freeze({
    version: PLAYABLE_WORLD_RC_VERSION,
    release_candidate: 'playable-world-rc1',
    seasons,
    club_count: clubCount,
    accepted: Object.values(checks).every(Boolean),
    checks,
    metrics: Object.freeze({
      fixtures_completed: first.reports.reduce((sum, row) => sum + row.season.season_report.fixture_count, 0),
      archives_created: archiveList.length,
      human_decisions_recorded: first.reports.reduce((sum, row) => sum + row.season.decisions.length, 0),
      ai_preseason_cycles: first.reports.reduce((sum, row) => sum + row.ai_preseason.length + row.ai_next_preseason.length, 0),
      world_events: finalWorld.event_ledger.length,
      squad_cycle_events: finalWorld.squad_cycle.events.length,
      players_in_universe: ids.length,
      owned_players: owned.length,
      free_agents: ids.length - owned.length,
      youth_intakes: first.reports.reduce((sum, row) => sum + row.world.event_ledger.filter((event) => event.type === 'club_youth_intake_completed' && event.season_id === row.next_season_id.replace(/season-(\d+)$/, (_, value) => `season-${Number(value) - 1}`)).length, 0),
      final_save_bytes: firstSave.bytes,
      final_save_sha256: firstSave.sha256,
      resumed_save_sha256: resumedSave.sha256,
      final_season_number: finalWorld.season_number,
      checkpoints: finalWorld.checkpoints.length
    }),
    season_summaries: Object.freeze(first.reports.map((row) => Object.freeze({
      season_id: row.season_id,
      accepted: row.accepted,
      champion_club_id: row.archive.summary.champion_club_id,
      human_position: row.season.final_standing.position,
      fixture_count: row.season.season_report.fixture_count,
      human_decisions: row.season.decisions.length,
      released_players: row.released_player_ids.length,
      next_squads_viable: row.next_season_viability.every((club) => club.viable)
    })))
  });
}
