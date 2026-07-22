import { portalWorldSummary } from '../../src/world/portalWorldControl.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
});

// Retained for historical PR #78 regression coverage and save-migration tooling.
// The manager-facing endpoint no longer writes manager-owned world saves.
export function assertWorldMatchesAppointment(world, appointment, { label = 'World' } = {}) {
  if (world.world_id !== appointment.world_id) throw new Error(`${label} does not match the active world appointment`);
  if (world.human_club_id !== appointment.club_id) throw new Error(`${label} does not match the active club appointment`);
  return true;
}

export function buildSavePayload(identityRow, result, { updatedAt = new Date().toISOString() } = {}) {
  const summary = result.summary || portalWorldSummary(result.world);
  const envelope = JSON.parse(result.saved_world);
  if (!envelope.save_version) throw new Error('Canonical save envelope is missing save_version');
  if (!envelope.checksum) throw new Error('Canonical save envelope is missing checksum');
  assertWorldMatchesAppointment(result.world, identityRow.appointment, { label: 'Saved world' });
  return {
    world_id: identityRow.appointment.world_id,
    manager_id: identityRow.manager.id,
    club_id: identityRow.appointment.club_id,
    save_version: envelope.save_version,
    save_checksum: envelope.checksum,
    save_envelope: envelope,
    season_id: summary.season_id,
    season_number: summary.season_number,
    phase: summary.phase,
    matchday: summary.current_matchday,
    updated_at: updatedAt
  };
}

export default async () => json({
  error: 'This private-save endpoint has been retired. TBG uses one shared canonical world; use /api/shared-world for manager submissions.'
}, 410);
