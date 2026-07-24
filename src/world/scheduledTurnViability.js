import { executeAiSquadPlan } from '../intelligence/aiSquadManagement.js';
import { analyseSquad } from '../intelligence/squadIntelligence.js';

export const SCHEDULED_TURN_VIABILITY_VERSION = 'tbg-scheduled-turn-viability-v1.0';

function clubName(world, clubId) {
  return String(world.club_profiles?.[clubId]?.club_name || world.club_profiles?.[clubId]?.canonical_name || clubId).trim();
}

function diagnostic(world, clubId, at) {
  const report = analyseSquad(world.squad_cycle, { clubId, at });
  const coverage = report.coverage
    .filter((row) => row.registered_gap > 0)
    .map((row) => ({ group: row.group, registered: row.registered, required: row.required, gap: row.registered_gap }));
  return {
    club_id: clubId,
    club_name: clubName(world, clubId),
    registered_seniors: report.summary.registered_seniors,
    hard_minimum_gap: report.summary.hard_minimum_gap,
    coverage,
    viable: report.summary.hard_minimum_gap === 0 && coverage.length === 0
  };
}

function describe(row) {
  const problems = [];
  if (row.hard_minimum_gap > 0) problems.push(`${row.registered_seniors} registered senior players; ${row.hard_minimum_gap} below the minimum`);
  for (const gap of row.coverage) problems.push(`${gap.group} coverage ${gap.registered}/${gap.required}`);
  return `${row.club_name}: ${problems.join(', ') || 'squad requires review'}`;
}

export function prepareScheduledTurnViability(world, { at } = {}) {
  if (world.phase !== 'preseason') return Object.freeze({
    version: SCHEDULED_TURN_VIABILITY_VERSION,
    applied: false,
    reason: `World phase is ${world.phase}`,
    repairs: Object.freeze([]),
    diagnostics: Object.freeze([])
  });

  const repairAt = at || world.squad_cycle.calendar?.transfer_windows?.[0]?.opens_at || world.clock;
  const repairs = [];
  const errors = [];
  for (const clubId of Object.keys(world.squad_cycle.clubs).sort()) {
    try {
      repairs.push(executeAiSquadPlan(world.squad_cycle, { clubId, at: repairAt }));
    } catch (error) {
      errors.push({ club_id: clubId, club_name: clubName(world, clubId), error: error.message });
    }
  }

  const diagnostics = Object.keys(world.squad_cycle.clubs).sort().map((clubId) => diagnostic(world, clubId, repairAt));
  const blocked = diagnostics.filter((row) => !row.viable);
  if (errors.length || blocked.length) {
    const details = [
      ...errors.map((row) => `${row.club_name}: ${row.error}`),
      ...blocked.map(describe)
    ];
    const error = new Error(`Preseason squad check needs attention: ${details.join('; ')}`);
    error.code = 'PRESEASON_SQUAD_NOT_VIABLE';
    error.diagnostics = { version: SCHEDULED_TURN_VIABILITY_VERSION, repair_at: repairAt, errors, clubs: blocked };
    throw error;
  }

  return Object.freeze({
    version: SCHEDULED_TURN_VIABILITY_VERSION,
    applied: true,
    repair_at: repairAt,
    repairs: Object.freeze(repairs),
    diagnostics: Object.freeze(diagnostics)
  });
}
