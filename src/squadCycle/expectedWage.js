const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

// Scouting & Finance Constitution v0.2 §2.
// BaseWage is an annual curve in £m-equivalent units, interpolated logarithmically.
export const BASE_WAGE_ANCHORS = Object.freeze([
  Object.freeze([40, 0.04]),
  Object.freeze([50, 0.12]),
  Object.freeze([60, 0.4]),
  Object.freeze([70, 1.2]),
  Object.freeze([80, 4.0]),
  Object.freeze([90, 10.0])
]);

function segmentForAbility(ability) {
  if (ability <= BASE_WAGE_ANCHORS[0][0]) return [BASE_WAGE_ANCHORS[0], BASE_WAGE_ANCHORS[1]];
  const last = BASE_WAGE_ANCHORS.length - 1;
  if (ability >= BASE_WAGE_ANCHORS[last][0]) return [BASE_WAGE_ANCHORS[last - 1], BASE_WAGE_ANCHORS[last]];
  for (let index = 0; index < last; index += 1) {
    const lower = BASE_WAGE_ANCHORS[index];
    const upper = BASE_WAGE_ANCHORS[index + 1];
    if (ability >= lower[0] && ability <= upper[0]) return [lower, upper];
  }
  return [BASE_WAGE_ANCHORS[0], BASE_WAGE_ANCHORS[1]];
}

export function baseAnnualWageMillions(abilityValue) {
  const ability = clamp(number(abilityValue, 50), 1, 100);
  const [[lowerAbility, lowerWage], [upperAbility, upperWage]] = segmentForAbility(ability);
  const progress = (ability - lowerAbility) / (upperAbility - lowerAbility);
  return Math.exp(Math.log(lowerWage) + progress * (Math.log(upperWage) - Math.log(lowerWage)));
}

export function reputationModifier(reputationValue) {
  const reputation = clamp(number(reputationValue, 50), 1, 100);
  return 1 + (0.005 * (reputation - 50));
}

export function ageModifier(ageValue) {
  const age = Math.max(0, number(ageValue, 25));
  if (age <= 21) return 0.85;
  if (age <= 24) return 0.95;
  if (age <= 30) return 1.00;
  if (age <= 33) return 0.95;
  return 0.90;
}

function abilityOf(player = {}) {
  return player.underlying_ability_rating ?? player.tbg_rating ?? player.rating ?? 50;
}

function reputationOf(player = {}) {
  return player.reputation ?? player.reputation_rating ?? player.player_reputation ?? 50;
}

export function expectedWeeklyWage(player = {}) {
  const annualPounds = baseAnnualWageMillions(abilityOf(player))
    * 1_000_000
    * reputationModifier(reputationOf(player))
    * ageModifier(player.age ?? player.season_start_age ?? 25);
  return Math.max(100, Math.round((annualPounds / 52) / 100) * 100);
}

export function withExpectedInitialWages(clubs = []) {
  return (Array.isArray(clubs) ? clubs : []).map((club) => ({
    ...club,
    players: (Array.isArray(club.players) ? club.players : []).map((player) => {
      const sourceContract = player.contract && typeof player.contract === 'object' ? player.contract : {};
      const suppliedWage = Number(sourceContract.wage);
      const wage = sourceContract.wage != null && Number.isFinite(suppliedWage) && suppliedWage >= 0
        ? Math.round(suppliedWage)
        : expectedWeeklyWage(player);
      return { ...player, contract: { ...sourceContract, wage } };
    })
  }));
}

export function isLegacyInitialPlaceholder(contract = {}, player = null) {
  if (Number(contract.wage) !== 1000 || contract.status !== 'active') return false;
  const playerId = String(contract.player_id || '');
  const clubId = String(contract.club_id || '');
  if (!playerId || !clubId || !player) return false;
  if (String(player.contract_id || '') && String(player.contract_id) !== String(contract.contract_id || '')) return false;
  // £1,000 was the old engine fallback. Treat it as a placeholder whenever the governed
  // ExpectedWage says this player belongs above that floor, regardless of whether a later
  // renewal/signing copied the placeholder into a timestamped replacement contract.
  return expectedWeeklyWage(player) > 1000;
}

export function contractWeeklyWage(player = {}, contract = null) {
  if (!contract) return null;
  if (isLegacyInitialPlaceholder(contract, player)) return expectedWeeklyWage(player);
  const wage = Number(contract.wage);
  return Number.isFinite(wage) && wage >= 0 ? wage : null;
}

export function migrateLegacyPlaceholderWages(world) {
  const state = world?.squad_cycle;
  if (!state?.contracts || !state?.players) return 0;
  let migrated = 0;
  for (const contract of Object.values(state.contracts)) {
    const player = state.players[contract?.player_id];
    if (!player || !isLegacyInitialPlaceholder(contract, player)) continue;
    const wage = expectedWeeklyWage(player);
    if (wage === Number(contract.wage)) continue;
    contract.wage = wage;
    migrated += 1;
  }
  return migrated;
}
