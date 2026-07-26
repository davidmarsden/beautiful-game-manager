const text = (value) => String(value ?? '').trim();

export const DEFAULT_LOAN_ELIGIBILITY_RULES = Object.freeze({ parentClubRestriction: false });
export const LOAN_RULE_INHERIT = 'inherit';

const playerId = (player) => text(player?.tbg_player_id || player?.player_id || player?.id);
const ownershipRows = (world = {}) => world.player_ownership || world.squad_cycle?.player_ownership || [];
const ownershipRow = (playerOrId, world = {}) => {
  const id = typeof playerOrId === 'string' ? text(playerOrId) : playerId(playerOrId);
  return ownershipRows(world).find((row) => text(row.tbg_player_id || row.player_id || row.id) === id) || null;
};
const ownerClubId = (player, ownership = {}) => text(ownership.parent_club_id || ownership.owner_club_id || ownership.owning_club_id || ownership.tbg_club_id || ownership.club_id || player?.parent_club_id || player?.owner_club_id || player?.owning_club_id || player?.tbg_club_id);
const loanRecord = (player, ownership = {}) => ownership.loan || player?.loan || ownership;
const loanClubId = (player, ownership = {}) => {
  const loan = loanRecord(player, ownership);
  return text(loan.club_id || loan.borrower_club_id || loan.tbg_club_id || ownership.loan_club_id || ownership.borrower_club_id || player?.loan_club_id || player?.borrower_club_id);
};

function competitionRuleSource(world = {}, fixture = {}) {
  const competitionId = text(fixture.competition_id || fixture.competitionId);
  if (!competitionId) return null;
  const collections = [world.competitions, world.competition?.competitions, world.competition?.divisions].filter(Array.isArray).flat();
  const competition = collections.find((row) => text(row.id || row.competition_id || row.division_id) === competitionId);
  return competition ? competition.rules?.loans || competition.loan_rules || competition.rules || competition : null;
}

const rawRule = (source) => source?.parent_club_restriction ?? source?.parentClubRestriction ?? source?.loan_parent_club_restriction;
function explicitBoolean(value) {
  if (value === true || value === false) return value;
  if (text(value).toLowerCase() === 'true') return true;
  if (text(value).toLowerCase() === 'false') return false;
  return null;
}

export function resolveParentClubRestriction({ world = {}, fixture = {}, competitionRules = null } = {}) {
  const competitionSources = [competitionRules, fixture.competition_rules, fixture.rules, competitionRuleSource(world, fixture), world.competition_rules?.[fixture.competition_id]].filter(Boolean);
  for (const source of competitionSources) {
    const value = rawRule(source);
    if (value === undefined || value === null || text(value).toLowerCase() === LOAN_RULE_INHERIT) continue;
    const enabled = explicitBoolean(value);
    if (enabled !== null) return Object.freeze({ enabled, source: 'competition', configured_value: enabled });
  }
  for (const source of [world.rules?.loans, world.loan_rules, world.rules].filter(Boolean)) {
    const enabled = explicitBoolean(rawRule(source));
    if (enabled !== null) return Object.freeze({ enabled, source: 'world', configured_value: enabled });
  }
  return Object.freeze({ enabled: DEFAULT_LOAN_ELIGIBILITY_RULES.parentClubRestriction, source: 'global_default', configured_value: DEFAULT_LOAN_ELIGIBILITY_RULES.parentClubRestriction });
}

export function parentClubRestrictionEnabled(input = {}) {
  return resolveParentClubRestriction(input).enabled;
}

export function fixtureOpponentClubId(fixture = {}, clubId) {
  const selected = text(clubId);
  const home = text(fixture.home_club_id || fixture.homeClubId || fixture.homeTeamId);
  const away = text(fixture.away_club_id || fixture.awayClubId || fixture.awayTeamId);
  if (selected === home) return away;
  if (selected === away) return home;
  return '';
}

function runtimeFixtures(world = {}) {
  return Object.values(world.matchday_cycle?.runtimes || {}).flatMap((runtime) => runtime?.fixtures || []);
}

export function findWorldFixture(world = {}, fixtureId) {
  const id = text(fixtureId);
  const collections = [world.fixtures, world.schedule, world.competition?.fixtures, ...(world.divisions || []).map((division) => division.fixtures), runtimeFixtures(world)].filter(Array.isArray);
  return collections.flat().find((fixture) => text(fixture.id || fixture.fixture_id) === id) || null;
}

export function fixtureEligibilityCheckpoint(fixture = {}) {
  const lockValue = fixture.eligibility_checkpoint_at || fixture.locked_at || fixture.lock_at || fixture.team_sheet_lock_at || fixture.submission_lock_at;
  const kickoffValue = fixture.kickoff_at || fixture.scheduled_kickoff_at || fixture.date;
  const timestamp = text(lockValue || kickoffValue);
  if (timestamp) return Object.freeze({ type: 'timestamp', value: timestamp, source: lockValue ? 'fixture_lock' : 'scheduled_kickoff' });
  const lockTurn = fixture.eligibility_checkpoint_turn ?? fixture.lock_turn;
  const kickoffTurn = fixture.kickoff_turn ?? fixture.matchday;
  const value = lockTurn ?? kickoffTurn;
  return Object.freeze({ type: 'turn', value: Number.isFinite(Number(value)) ? Number(value) : null, source: lockTurn !== undefined ? 'fixture_lock' : 'scheduled_kickoff' });
}

function withinCheckpoint(value, checkpoint, comparison) {
  if (value === undefined || value === null || value === '') return true;
  if (checkpoint.type === 'turn') return comparison(Number(value), Number(checkpoint.value));
  return comparison(new Date(value).getTime(), new Date(checkpoint.value).getTime());
}

function loanActiveAtCheckpoint(player, ownership, checkpoint) {
  const loan = loanRecord(player, ownership);
  const status = text(loan.status || ownership.loan_status || player?.loan_status).toLowerCase();
  if (['ended', 'expired', 'recalled', 'cancelled', 'inactive'].includes(status)) return false;
  const start = loan.start_at ?? loan.starts_at ?? loan.start_date ?? loan.start_turn ?? ownership.loan_start_at ?? ownership.loan_start_turn;
  const end = loan.end_at ?? loan.ends_at ?? loan.end_date ?? loan.end_turn ?? ownership.loan_end_at ?? ownership.loan_end_turn;
  if (checkpoint.value === null) return Boolean(loanClubId(player, ownership));
  return withinCheckpoint(start, checkpoint, (left, right) => left <= right) && withinCheckpoint(end, checkpoint, (left, right) => left >= right);
}

export function loanEligibility({ player, player_id, club_id, fixture, world = {}, competition_rules = null, checkpoint = null } = {}) {
  const players = world.players || Object.values(world.squad_cycle?.players || {});
  const selectedPlayer = player || players.find((row) => playerId(row) === text(player_id));
  const selectedPlayerId = playerId(selectedPlayer) || text(player_id);
  const selectedClubId = text(club_id);
  const ownership = ownershipRow(selectedPlayerId, world) || {};
  const parentClubId = ownerClubId(selectedPlayer, ownership);
  const borrowingClubId = loanClubId(selectedPlayer, ownership);
  const opponentClubId = fixtureOpponentClubId(fixture, selectedClubId);
  const rule = resolveParentClubRestriction({ world, fixture, competitionRules: competition_rules });
  const eligibilityCheckpoint = checkpoint || fixtureEligibilityCheckpoint(fixture);
  const active = loanActiveAtCheckpoint(selectedPlayer, ownership, eligibilityCheckpoint);
  const onLoanHere = Boolean(active && selectedPlayerId && selectedClubId && borrowingClubId === selectedClubId && parentClubId && parentClubId !== selectedClubId);
  const facesParentClub = Boolean(onLoanHere && opponentClubId && opponentClubId === parentClubId);
  const eligible = !(rule.enabled && facesParentClub);
  return Object.freeze({ eligible, reason: eligible ? null : 'parent_club_fixture', player_id: selectedPlayerId, club_id: selectedClubId, parent_club_id: parentClubId || null, loan_club_id: borrowingClubId || null, opponent_club_id: opponentClubId || null, loan_active_at_checkpoint: active, checkpoint: eligibilityCheckpoint, rule_enabled: rule.enabled, rule_source: rule.source });
}

export function createLoanEligibilitySnapshot({ playerIds = [], clubId, fixture, world = {} } = {}) {
  const checkpoint = fixtureEligibilityCheckpoint(fixture);
  const outcomes = playerIds.map((id) => loanEligibility({ player_id: id, club_id: clubId, fixture, world, checkpoint }));
  return Object.freeze({ version: 'loan-fixture-eligibility-v0.2', fixture_id: text(fixture?.id || fixture?.fixture_id), club_id: text(clubId), checkpoint, rule: resolveParentClubRestriction({ world, fixture }), outcomes: Object.freeze(outcomes) });
}

export function ineligibleLoanPlayerIds({ playerIds = [], clubId, fixture, world = {}, snapshot = null } = {}) {
  if (snapshot?.version === 'loan-fixture-eligibility-v0.2') return snapshot.outcomes.filter((row) => !row.eligible && playerIds.includes(row.player_id)).map((row) => row.player_id);
  return playerIds.filter((id) => !loanEligibility({ player_id: id, club_id: clubId, fixture, world }).eligible);
}
