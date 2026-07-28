const PUBLIC_PLAYER_FIELDS = Object.freeze([
  'tbg_player_id', 'display_name', 'canonical_name', 'date_of_birth', 'age',
  'nationality', 'country', 'specific_position', 'primary_position', 'position_group',
  'underlying_ability_rating', 'tbg_rating', 'official_potential_band',
  'source_profile_url', 'pink_final_route_key', 'pink_final_profile_status', 'profile_url'
]);

const PUBLIC_CLUB_FIELDS = Object.freeze([
  'club_id', 'tbg_club_id', 'canonical_name', 'club_name', 'country', 'city',
  'founded', 'crest_url', 'pink_final_club_route_key',
  'pink_final_club_profile_status', 'pink_final_club_profile_url'
]);

const MANAGER_VISIBLE_LIVE_FIELDS = Object.freeze([
  'club_id', 'club_name', 'players', 'division_id', 'division_name', 'league_position',
  'fixtures', 'results', 'fitness', 'morale', 'availability', 'injury_status',
  'contract', 'contract_expiry', 'contract_end_at', 'registration_status',
  'transfer_status', 'loan_status', 'appearances', 'goals', 'assists',
  'average_match_rating', 'board_objective', 'board_confidence'
]);

const NEVER_PUBLIC_FIELDS = Object.freeze([
  'world_id', 'save_id', 'save_checksum', 'manager_id', 'manager_email',
  'appointment_id', 'appointment', 'access_token', 'refresh_token',
  'submission', 'submissions', 'team_submission', 'team_sheet', 'tactics_submission',
  'manager_command', 'manager_commands', 'command_queue', 'pending_commands',
  'sealed_bid', 'sealed_bids', 'shortlist', 'private_shortlist', 'scouting_notes',
  'true_potential', 'true_preference_weights', 'unrevealed_result',
  'unrevealed_results', 'pending_result', 'pending_results', 'simulation_seed'
]);

const FORBIDDEN_PUBLIC_ROUTE_KEYS = new Set([
  'world', 'world_id', 'save', 'save_id', 'manager', 'manager_id',
  'appointment', 'appointment_id', 'season', 'season_id', 'squad', 'squad_id',
  'fixture', 'fixture_id', 'match', 'match_id', 'result', 'result_id'
]);

const own = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);

function pick(record = {}, fields = []) {
  return Object.fromEntries(fields.filter((field) => own(record, field)).map((field) => [field, record[field]]));
}

function assertNoPrivateFields(value, path = '$') {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoPrivateFields(entry, `${path}[${index}]`));
    return value;
  }
  if (!value || typeof value !== 'object') return value;
  for (const [key, entry] of Object.entries(value)) {
    if (NEVER_PUBLIC_FIELDS.includes(key)) throw new Error(`Private field ${path}.${key} cannot enter a public projection`);
    assertNoPrivateFields(entry, `${path}.${key}`);
  }
  return value;
}

function hasForbiddenRouteScope(url) {
  return [...url.searchParams.keys()].some((key) => FORBIDDEN_PUBLIC_ROUTE_KEYS.has(key.toLowerCase()));
}

export function projectPublicPlayer(player = {}) {
  return assertNoPrivateFields(pick(player, PUBLIC_PLAYER_FIELDS));
}

export function projectPublicClub(club = {}) {
  return assertNoPrivateFields(pick(club, PUBLIC_CLUB_FIELDS));
}

export function projectPublicDirectory({ players = [], clubs = [] } = {}) {
  return {
    players: players.map(projectPublicPlayer),
    clubs: clubs.map(projectPublicClub)
  };
}

export function projectManagerVisibleLiveState(state = {}) {
  return pick(state, MANAGER_VISIBLE_LIVE_FIELDS);
}

export function safeExplicitPublicProfileUrl(value, baseUrl) {
  try {
    const url = new URL(String(value || '').trim(), baseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || hasForbiddenRouteScope(url)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function publicProfileUrl(baseUrl, routeKey, parameter = 'id') {
  const key = String(routeKey ?? '').trim();
  if (!key || !/^[A-Za-z0-9._:-]{1,160}$/.test(key)) return null;
  const url = new URL(baseUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
  url.search = '';
  url.hash = '';
  url.searchParams.set(parameter, key);
  return url.toString();
}

export function assertPublicProjection(value) {
  return assertNoPrivateFields(value);
}

export {
  PUBLIC_PLAYER_FIELDS,
  PUBLIC_CLUB_FIELDS,
  MANAGER_VISIBLE_LIVE_FIELDS,
  NEVER_PUBLIC_FIELDS,
  FORBIDDEN_PUBLIC_ROUTE_KEYS
};
