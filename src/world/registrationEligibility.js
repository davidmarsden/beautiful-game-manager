const text = (value) => String(value ?? '').trim();
const number = (value, fallback = null) => Number.isFinite(Number(value)) ? Number(value) : fallback;

const YOUTH_REGISTRATION_MARKERS = new Set(['youth', 'youth_eligible', 'youth_only', 'academy']);

export function isYouthRegistrationExempt(player, contract = null) {
  const playerRegistration = text(player?.squad_registration || player?.registration_group || player?.squad_status).toLowerCase();
  if (YOUTH_REGISTRATION_MARKERS.has(playerRegistration)) return true;
  const contractRegistration = text(contract?.squad_registration).toLowerCase();
  if (YOUTH_REGISTRATION_MARKERS.has(contractRegistration)) return true;
  if (player?.youth_eligible_at_season_start !== undefined) return Boolean(player.youth_eligible_at_season_start);
  return number(player?.season_start_age ?? player?.age, 99) <= 21;
}

export function competitiveRegistration(world, club, playerId, player = null) {
  const playerRow = player || world?.squad_cycle?.players?.[playerId] || null;
  const contract = playerRow?.contract_id ? world?.squad_cycle?.contracts?.[playerRow.contract_id] || null : null;
  if (isYouthRegistrationExempt(playerRow, contract)) {
    return Object.freeze({ registered: true, status: 'youth_exempt', youth_exempt: true });
  }

  if (Array.isArray(club?.registered_player_ids)) {
    const registered = club.registered_player_ids.includes(playerId);
    return Object.freeze({ registered, status: registered ? 'registered' : 'unregistered', youth_exempt: false });
  }

  const registration = world?.squad_cycle?.state?.registrations?.[playerId];
  if (typeof registration === 'boolean') {
    return Object.freeze({ registered: registration, status: registration ? 'registered' : 'unregistered', youth_exempt: false });
  }
  if (registration && typeof registration === 'object') {
    if (typeof registration.registered === 'boolean') {
      return Object.freeze({ registered: registration.registered, status: registration.registered ? 'registered' : 'unregistered', youth_exempt: false });
    }
    if (registration.status) {
      const registered = registration.status === 'registered';
      return Object.freeze({ registered, status: registered ? 'registered' : 'unregistered', youth_exempt: false });
    }
  }

  const registered = Boolean(playerRow?.registered);
  return Object.freeze({ registered, status: registered ? 'registered' : 'unregistered', youth_exempt: false });
}
