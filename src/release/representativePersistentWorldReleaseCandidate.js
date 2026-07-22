import { performance } from 'node:perf_hooks';
import { syntheticPlayableLeagueStructure } from '../matchEngine/leagueStructureSimulation.js';
import { createPersistentLeagueWorld } from '../world/persistentLeagueWorld.js';
import { advancePersistentMatchday, validatePersistentMatchdayWorld } from '../world/persistentMatchdayWorld.js';
import {
  applyPlayerLifecycleReconciliation,
  PLAYER_LIFECYCLE_MANIFEST_VERSION,
  REALITY_STATUS,
  validatePlayerLifecycleWorld
} from '../world/playerLifecycleReconciliation.js';
import {
  loadPortalWorld,
  renewPortalContract,
  transferPortalPlayer
} from '../world/portalWorldControl.js';
import { loadPersistentWorld, savePersistentWorld } from '../world/persistentSeasonLoop.js';
import {
  buildRestorePlan,
  buildWorldBackupRecord,
  inspectPersistentSave
} from '../world/worldOperations.js';
import { squadCycleSnapshot } from '../squadCycle/squadCycle.js';

export const REPRESENTATIVE_WORLD_RC_VERSION = 'tbg-representative-persistent-world-rc-v1.0';
export const REPRESENTATIVE_WORLD_RC_NAME = 'representative-persistent-world-rc1';
export const DEFAULT_REPRESENTATIVE_CLUBS_PER_DIVISION = 8;
export const DEFAULT_REPRESENTATIVE_SEASONS = 3;

const unique = (values) => new Set(values).size === values.length;
const bytes = (value) => Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value));

function storedSave(world, managerId = 'representative-manager', updatedAt = '2026-07-22T12:00:00.000Z') {
  const savedWorld = savePersistentWorld(world);
  const envelope = JSON.parse(savedWorld);
  return Object.freeze({
    world_id: world.world_id,
    manager_id: managerId,
    club_id: world.human_club_id,
    save_version: envelope.save_version,
    save_checksum: envelope.checksum,
    save_envelope: envelope,
    updated_at: updatedAt
  });
}

function prepareWorld({ clubsPerDivision, worldId }) {
  const divisions = syntheticPlayableLeagueStructure({ clubsPerDivision });
  let world = createPersistentLeagueWorld({
    worldId,
    divisions,
    humanClubId: divisions[0].clubs[0].club_id,
    movementCount: 1
  });

  const humanClub = world.squad_cycle.clubs[world.human_club_id];
  const renewedPlayerId = humanClub.player_ids[0];
  world = renewPortalContract(world, { playerId: renewedPlayerId, years: 3 }).world;

  const seller = divisions[0].clubs[1].club_id;
  const boughtPlayerId = world.squad_cycle.clubs[seller].player_ids.at(-1);
  world = transferPortalPlayer(world, {
    playerId: boughtPlayerId,
    direction: 'buy',
    otherClubId: seller,
    fee: 2500000,
    contractYears: 4
  }).world;

  return Object.freeze({ world, renewedPlayerId, boughtPlayerId, sellerClubId: seller });
}

function lifecycleManifest(world) {
  const aiClubIds = Object.keys(world.squad_cycle.clubs).filter((id) => id !== world.human_club_id).sort();
  const retired = world.squad_cycle.clubs[aiClubIds[0]].registered_player_ids[0];
  const inactive = world.squad_cycle.clubs[aiClubIds[1]].registered_player_ids[0];
  const reviewed = world.squad_cycle.clubs[aiClubIds[2]].registered_player_ids[0];
  return Object.freeze({
    version: PLAYER_LIFECYCLE_MANIFEST_VERSION,
    source_snapshot_id: 'tm-representative-rc-2026-08-01',
    effective_at: '2026-08-01T00:00:00.000Z',
    players: Object.freeze([
      { tbg_player_id: retired, new_status: REALITY_STATUS.retired, source: 'transfermarkt', evidence_ref: 'rc:retired' },
      { tbg_player_id: inactive, new_status: REALITY_STATUS.withoutClubTooLong, source: 'transfermarkt', evidence_ref: 'rc:without-club' },
      { tbg_player_id: reviewed, new_status: REALITY_STATUS.underReview, source: 'transfermarkt', evidence_ref: 'rc:review' }
    ])
  });
}

function seasonMatchdays(clubsPerDivision) {
  return (clubsPerDivision - 1) * 2;
}

function runTrajectory({
  clubsPerDivision,
  seasons,
  splitAfter = null,
  resumeEnvelope = null,
  lifecycleAfter = 3,
  worldId = 'representative-persistent-world'
}) {
  const prepared = resumeEnvelope
    ? { world: loadPersistentWorld(resumeEnvelope), renewedPlayerId: null, boughtPlayerId: null, sellerClubId: null }
    : prepareWorld({ clubsPerDivision, worldId });
  let world = prepared.world;
  const totalMatchdays = seasons * seasonMatchdays(clubsPerDivision);
  const reports = [];
  const saves = [];
  let manifestApplied = Boolean(world.reality_sync?.applied_snapshot_ids?.includes('tm-representative-rc-2026-08-01'));
  const manifest = lifecycleManifest(world);

  for (let index = 0; index < totalMatchdays; index += 1) {
    const report = advancePersistentMatchday(world, {
      humanInstruction: { formation: '4-3-3-wide', tactics: { mentality: 'positive', pressing: 'mid' } }
    });
    reports.push(report);
    world = report.world;
    if (!manifestApplied && reports.length === lifecycleAfter) {
      const reconciliation = applyPlayerLifecycleReconciliation(world, manifest);
      if (!reconciliation.accepted) throw new Error('Representative lifecycle reconciliation was rejected');
      world = reconciliation.world;
      manifestApplied = true;
    }
    if (splitAfter && reports.length === splitAfter) saves.push(savePersistentWorld(world));
  }

  return Object.freeze({
    world,
    reports: Object.freeze(reports),
    saved_world: savePersistentWorld(world),
    split_save: saves[0] || null,
    prepared
  });
}

function countFixtures(reports) {
  return reports.reduce((sum, row) => sum + row.checkpoint.fixture_count, 0);
}

function worldFacts(world) {
  const players = Object.values(world.squad_cycle.players);
  const contracts = Object.values(world.squad_cycle.contracts);
  const registrations = Object.values(world.squad_cycle.registrations);
  const movementIds = world.competition.movement_history.map((row) => row.movement_id);
  const archiveIds = world.history.archives.map((row) => row.archive_id);
  const eventIds = world.event_ledger.map((row) => row.event_id);
  const squadEventIds = world.squad_cycle.events.map((row) => row.event_id);
  const checkpointIds = (world.matchday_history || []).flatMap((row) => row.checkpoints.map((checkpoint) => checkpoint.checkpoint_id));
  return Object.freeze({
    players,
    contracts,
    registrations,
    movementIds,
    archiveIds,
    eventIds,
    squadEventIds,
    checkpointIds
  });
}

export function buildRepresentativePersistentWorldReleaseCandidate({
  clubsPerDivision = DEFAULT_REPRESENTATIVE_CLUBS_PER_DIVISION,
  seasons = DEFAULT_REPRESENTATIVE_SEASONS,
  worldId = 'representative-persistent-world'
} = {}) {
  if (!Number.isInteger(clubsPerDivision) || clubsPerDivision < 4) throw new Error('Representative RC requires at least four clubs per division');
  if (!Number.isInteger(seasons) || seasons < 2) throw new Error('Representative RC requires at least two seasons');

  const startedAt = performance.now();
  const matchdaysPerSeason = seasonMatchdays(clubsPerDivision);
  const totalMatchdays = matchdaysPerSeason * seasons;
  const splitAfter = Math.floor(totalMatchdays / 2);

  const primary = runTrajectory({ clubsPerDivision, seasons, splitAfter, worldId });
  const repeated = runTrajectory({ clubsPerDivision, seasons, worldId });

  const firstHalf = runTrajectory({
    clubsPerDivision,
    seasons: 1,
    splitAfter,
    worldId
  });
  let resumedWorld = loadPersistentWorld(primary.split_save);
  const remainingMatchdays = totalMatchdays - splitAfter;
  const resumedReports = [];
  for (let index = 0; index < remainingMatchdays; index += 1) {
    const report = advancePersistentMatchday(resumedWorld, {
      humanInstruction: { formation: '4-3-3-wide', tactics: { mentality: 'positive', pressing: 'mid' } }
    });
    resumedReports.push(report);
    resumedWorld = report.world;
  }
  const resumedSave = savePersistentWorld(resumedWorld);

  const checkpointWorld = loadPersistentWorld(primary.split_save);
  const checkpointStored = storedSave(checkpointWorld, 'representative-manager', '2026-07-22T12:00:00.000Z');
  const backup = buildWorldBackupRecord(checkpointStored, {
    backupId: 'representative-midpoint-backup',
    trigger: 'manual',
    reason: 'representative_rc_midpoint',
    createdAt: '2026-07-22T12:05:00.000Z'
  });
  const finalStored = storedSave(primary.world, 'representative-manager', '2026-07-22T13:00:00.000Z');
  const restorePlan = buildRestorePlan(finalStored, backup, {
    expectedChecksum: finalStored.save_checksum,
    requestedAt: '2026-07-22T13:05:00.000Z'
  });
  let replayWorld = loadPersistentWorld(JSON.stringify(restorePlan.replacement.save_envelope));
  for (let index = 0; index < remainingMatchdays; index += 1) {
    replayWorld = advancePersistentMatchday(replayWorld, {
      humanInstruction: { formation: '4-3-3-wide', tactics: { mentality: 'positive', pressing: 'mid' } }
    }).world;
  }
  const replaySave = savePersistentWorld(replayWorld);

  const portalLoad = loadPortalWorld(primary.saved_world);
  const inspection = inspectPersistentSave(finalStored, {
    now: '2026-07-22T13:10:00.000Z',
    latestBackup: backup,
    staleAfterHours: 24,
    backupMaxAgeHours: 24
  });
  const facts = worldFacts(primary.world);
  const elapsedMs = Math.round(performance.now() - startedAt);
  const expectedClubs = clubsPerDivision * 5;
  const expectedFixturesPerSeason = 5 * clubsPerDivision * (clubsPerDivision - 1);
  const expectedFixtures = expectedFixturesPerSeason * seasons;
  const expectedMovements = seasons * 8;
  const expectedArchives = seasons * 5;
  const lifecycleValidation = validatePlayerLifecycleWorld(primary.world);
  const matchdayValidation = validatePersistentMatchdayWorld(primary.world);
  const squadSnapshot = squadCycleSnapshot(primary.world.squad_cycle);

  const checks = Object.freeze({
    representative_scale_reached: expectedClubs >= 40 && facts.players.length >= expectedClubs * 18,
    every_primary_matchday_accepted: primary.reports.every((row) => row.accepted),
    fixture_count_matches_schedule: countFixtures(primary.reports) === expectedFixtures,
    deterministic_full_run: primary.saved_world === repeated.saved_world,
    resumed_run_matches_continuous: resumedSave === primary.saved_world,
    restored_replay_matches_continuous: replaySave === primary.saved_world,
    portal_load_accepts_final_save: portalLoad.accepted && portalLoad.world.world_id === primary.world.world_id,
    operational_backup_loads: restorePlan.accepted && inspection.checks.envelope_loads,
    lifecycle_reconciliation_persisted: primary.world.reality_sync?.reconciliations?.length === 3,
    lifecycle_world_valid: lifecycleValidation.valid,
    matchday_world_valid: matchdayValidation.valid,
    squad_cycle_valid: squadSnapshot.accepted,
    seasons_advanced_exactly: primary.world.season_number === seasons + 1,
    final_world_returns_to_preseason: primary.world.phase === 'preseason',
    archives_complete_and_unique: facts.archiveIds.length === expectedArchives && unique(facts.archiveIds),
    movements_complete_and_unique: facts.movementIds.length === expectedMovements && unique(facts.movementIds),
    checkpoint_ids_unique: unique(facts.checkpointIds),
    player_ids_unique: unique(facts.players.map((row) => row.tbg_player_id)),
    world_event_ids_unique: unique(facts.eventIds),
    squad_event_ids_unique: unique(facts.squadEventIds),
    registrations_reference_players: facts.registrations.every((row) => facts.players.some((player) => player.tbg_player_id === row.player_id)),
    owned_players_have_active_contracts: facts.players.filter((row) => row.club_id).every((row) => facts.contracts.some((contract) => contract.contract_id === row.contract_id && contract.status === 'active')),
    portal_contract_action_persisted: facts.eventIds.some((id) => id.endsWith(':portal_renew_contract')),
    portal_transfer_action_persisted: facts.eventIds.some((id) => id.endsWith(':portal_transfer_player')),
    final_save_nonempty: bytes(primary.saved_world) > 0
  });

  return Object.freeze({
    version: REPRESENTATIVE_WORLD_RC_VERSION,
    release_candidate: REPRESENTATIVE_WORLD_RC_NAME,
    profile: Object.freeze({
      divisions: 5,
      clubs_per_division: clubsPerDivision,
      clubs: expectedClubs,
      seasons,
      matchdays_per_season: matchdaysPerSeason,
      total_matchdays: totalMatchdays,
      expected_fixtures: expectedFixtures
    }),
    accepted: Object.values(checks).every(Boolean),
    checks,
    metrics: Object.freeze({
      runtime_ms: elapsedMs,
      fixtures_completed: countFixtures(primary.reports),
      archives_created: facts.archiveIds.length,
      movements_recorded: facts.movementIds.length,
      checkpoints_recorded: facts.checkpointIds.length,
      players_in_universe: facts.players.length,
      active_contracts: facts.contracts.filter((row) => row.status === 'active').length,
      registered_players: facts.registrations.filter((row) => row.registered).length,
      world_events: facts.eventIds.length,
      squad_cycle_events: facts.squadEventIds.length,
      final_save_bytes: bytes(primary.saved_world),
      final_save_checksum: JSON.parse(primary.saved_world).checksum,
      resumed_save_checksum: JSON.parse(resumedSave).checksum,
      replayed_save_checksum: JSON.parse(replaySave).checksum,
      final_season_number: primary.world.season_number,
      final_phase: primary.world.phase
    }),
    evidence: Object.freeze({
      backup_id: backup.backup_id,
      restore_operation_id: restorePlan.operation_id,
      inspection_severity: inspection.severity,
      lifecycle_snapshot_id: primary.world.reality_sync?.last_applied_snapshot_id || null,
      portal_summary: portalLoad.summary
    })
  });
}
