const text = (value) => String(value ?? '').trim();

export const DEFAULT_LOAN_ELIGIBILITY_RULES = Object.freeze({ parentClubRestriction: false });

const playerId = (player) => text(player?.tbg_player_id || player?.player_id || player?.id);
const ownershipRow = (playerOrId, world = {}) => {
  const id = typeof playerOrId === 'string' ? text(playerOrId) : playerId(playerOrId);
  return (world.player_ownership || []).find((row) => text(row.tbg_player_id || row.player_id || row.id) === id) || null;
};
const ownerClubId = (player, ownership = {}) => text(ownership.parent_club_id || ownership.owner_club_id || ownership.owning_club_id || ownership.club_id || player?.parent_club_id || player?.owner_club_id || player?.owning_club_id);
const loanClubId = (player, ownership = {}) => {
  const loan = ownership.loan || player?.loan || {};
  return text(loan.club_id || loan.borrower_club_id || ownership.loan_club_id || ownership.borrower_club_id || player?.loan_club_id || player?.borrower_club_id);
};

export function parentClubRestrictionEnabled({ world = {}, fixture = {}, competitionRules = null } = {}) {
  const sources = [competitionRules, fixture.competition_rules, fixture.rules, world.competition_rules?.[fixture.competition_id], world.rules?.loans, world.loan_rules, world.rules].filter(Boolean);
  for (const source of sources) {
    const value = source.parent_club_restriction ?? source.parentClubRestriction ?? source.loan_parent_club_restriction;
    if (value !== undefined) return Boolean(value);
  }
  return DEFAULT_LOAN_ELIGIBILITY_RULES.parentClubRestriction;
}

export function fixtureOpponentClubId(fixture = {}, clubId) {
  const selected = text(clubId);
  const home = text(fixture.home_club_id || fixture.homeClubId);
  const away = text(fixture.away_club_id || fixture.awayClubId);
  if (selected === home) return away;
  if (selected === away) return home;
  return '';
}

export function findWorldFixture(world = {}, fixtureId) {
  const id = text(fixtureId);
  const collections = [
    world.fixtures,
    world.schedule,
    world.competition?.fixtures,
    ...(world.divisions || []).map((division) => division.fixtures)
  ].filter(Array.isArray);
  return collections.flat().find((fixture) => text(fixture.id || fixture.fixture_id) === id) || null;
}

export function loanEligibility({ player, player_id, club_id, fixture, world = {}, competition_rules = null } = {}) {
  const selectedPlayer = player || (world.players || []).find((row) => playerId(row) === text(player_id));
  const selectedPlayerId = playerId(selectedPlayer) || text(player_id);
  const selectedClubId = text(club_id);
  const ownership = ownershipRow(selectedPlayerId, world) || {};
  const parentClubId = ownerClubId(selectedPlayer, ownership);
  const borrowingClubId = loanClubId(selectedPlayer, ownership);
  const opponentClubId = fixtureOpponentClubId(fixture, selectedClubId);
  const restricted = parentClubRestrictionEnabled({ world, fixture, competitionRules: competition_rules });
  const onLoanHere = Boolean(selectedPlayerId && selectedClubId && borrowingClubId === selectedClubId && parentClubId && parentClubId !== selectedClubId);
  const facesParentClub = Boolean(onLoanHere && opponentClubId && opponentClubId === parentClubId);
  const eligible = !(restricted && facesParentClub);
  return Object.freeze({ eligible, reason: eligible ? null : 'parent_club_fixture', player_id: selectedPlayerId, club_id: selectedClubId, parent_club_id: parentClubId || null, loan_club_id: borrowingClubId || null, opponent_club_id: opponentClubId || null, rule_enabled: restricted });
}

export function ineligibleLoanPlayerIds({ playerIds = [], clubId, fixture, world = {} } = {}) {
  return playerIds.filter((id) => !loanEligibility({ player_id: id, club_id: clubId, fixture, world }).eligible);
}
