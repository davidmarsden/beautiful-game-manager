const text = (value) => String(value ?? '').trim();
const integer = (value, fallback = 0) => Number.isInteger(Number(value)) ? Number(value) : fallback;
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

export const SQUAD_CYCLE_VERSION = 'tbg-squad-cycle-v1.0';
export const DEFAULT_REGISTRATION_LIMIT = 25;
export const DEFAULT_YOUTH_INTAKE_SIZE = 3;

const DAY = 86400000;

function iso(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid date: ${value}`);
  return date.toISOString();
}

function addDays(value, days) {
  return new Date(new Date(value).getTime() + days * DAY).toISOString();
}

function hash(value) {
  let result = 2166136261;
  for (const character of text(value)) {
    result ^= character.charCodeAt(0);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function playerId(player) {
  return text(player?.tbg_player_id || player?.player_id || player?.id);
}

function clonePlayer(player) {
  const id = playerId(player);
  if (!id) throw new Error('Every squad-cycle player requires an ID');
  return {
    ...player,
    tbg_player_id: id,
    display_name: text(player.display_name || player.name || id),
    age: integer(player.age, 24),
    underlying_ability_rating: clamp(number(player.underlying_ability_rating ?? player.rating, 75), 1, 100)
  };
}

function normaliseContract(player, clubId, seasonEnd) {
  const source = player.contract || {};
  return {
    contract_id: text(source.contract_id) || `${player.tbg_player_id}:${clubId}:contract`,
    player_id: player.tbg_player_id,
    club_id: clubId,
    start_at: iso(source.start_at || addDays(seasonEnd, -365)),
    end_at: iso(source.end_at || seasonEnd),
    wage: Math.max(0, integer(source.wage, 1000)),
    status: source.status === 'expired' || source.status === 'released' ? source.status : 'active'
  };
}

function event(state, type, at, payload = {}) {
  const row = Object.freeze({
    event_id: `${state.season_id}:${String(state.events.length + 1).padStart(4, '0')}:${type}`,
    type,
    at: iso(at),
    ...payload
  });
  state.events.push(row);
  return row;
}

function club(state, clubId) {
  const row = state.clubs[text(clubId)];
  if (!row) throw new Error(`Unknown club: ${clubId}`);
  return row;
}

function ownedPlayer(state, playerIdValue) {
  const id = text(playerIdValue);
  const row = state.players[id];
  if (!row) throw new Error(`Unknown player: ${playerIdValue}`);
  return row;
}

function isWithin(date, start, end) {
  const value = new Date(date).getTime();
  return value >= new Date(start).getTime() && value <= new Date(end).getTime();
}

export function defaultSquadCycleCalendar({ seasonId = 'season', seasonStart = '2026-08-01T00:00:00.000Z', seasonEnd = '2027-06-30T23:59:59.000Z' } = {}) {
  const start = iso(seasonStart);
  const end = iso(seasonEnd);
  return Object.freeze({
    season_id: seasonId,
    season_start: start,
    season_end: end,
    transfer_windows: Object.freeze([
      Object.freeze({ window_id: `${seasonId}:summer`, name: 'summer', opens_at: addDays(start, -45), closes_at: addDays(start, 31) }),
      Object.freeze({ window_id: `${seasonId}:winter`, name: 'winter', opens_at: addDays(start, 153), closes_at: addDays(start, 184) })
    ]),
    registration_deadlines: Object.freeze([
      Object.freeze({ deadline_id: `${seasonId}:summer-registration`, closes_at: addDays(start, 34) }),
      Object.freeze({ deadline_id: `${seasonId}:winter-registration`, closes_at: addDays(start, 187) })
    ]),
    youth_intake_at: addDays(end, -75),
    contract_expiry_at: end
  });
}

export function createSquadCycleState({
  clubs = [],
  seasonId = 'season',
  seasonStart,
  seasonEnd,
  registrationLimit = DEFAULT_REGISTRATION_LIMIT
} = {}) {
  if (!Array.isArray(clubs) || clubs.length < 2) throw new Error('Squad cycle requires at least two clubs');
  const calendar = defaultSquadCycleCalendar({ seasonId, seasonStart, seasonEnd });
  const state = {
    version: SQUAD_CYCLE_VERSION,
    season_id: seasonId,
    calendar,
    registration_limit: integer(registrationLimit, DEFAULT_REGISTRATION_LIMIT),
    clubs: Object.create(null),
    players: Object.create(null),
    contracts: Object.create(null),
    registrations: Object.create(null),
    events: []
  };

  for (const sourceClub of clubs) {
    const clubId = text(sourceClub.club_id);
    if (!clubId || state.clubs[clubId]) throw new Error(`Invalid or duplicate club ID: ${clubId}`);
    state.clubs[clubId] = {
      club_id: clubId,
      club_name: text(sourceClub.club_name || clubId),
      player_ids: [],
      registered_player_ids: []
    };
    for (const sourcePlayer of sourceClub.players || []) {
      const player = clonePlayer(sourcePlayer);
      if (state.players[player.tbg_player_id]) throw new Error(`Duplicate player ID: ${player.tbg_player_id}`);
      player.club_id = clubId;
      state.players[player.tbg_player_id] = player;
      state.clubs[clubId].player_ids.push(player.tbg_player_id);
      const contract = normaliseContract(player, clubId, calendar.season_end);
      state.contracts[contract.contract_id] = contract;
      player.contract_id = contract.contract_id;
      state.registrations[player.tbg_player_id] = {
        player_id: player.tbg_player_id,
        club_id: clubId,
        registered: sourcePlayer.registered !== false,
        registered_at: calendar.transfer_windows[0].opens_at
      };
      if (sourcePlayer.registered !== false) state.clubs[clubId].registered_player_ids.push(player.tbg_player_id);
    }
  }
  return state;
}

export function activeTransferWindow(state, at) {
  return state.calendar.transfer_windows.find((window) => isWithin(at, window.opens_at, window.closes_at)) || null;
}

export function registrationOpen(state, at) {
  const value = new Date(at).getTime();
  const nextDeadline = state.calendar.registration_deadlines.find((row) => value <= new Date(row.closes_at).getTime());
  return Boolean(nextDeadline);
}

export function registerPlayer(state, { clubId, playerId: idValue, at } = {}) {
  const atIso = iso(at);
  const target = club(state, clubId);
  const player = ownedPlayer(state, idValue);
  if (player.club_id !== target.club_id) throw new Error(`${player.tbg_player_id} is not owned by ${target.club_id}`);
  if (!registrationOpen(state, atIso)) throw new Error(`Registration is closed at ${atIso}`);
  const existing = state.registrations[player.tbg_player_id];
  if (existing?.registered && existing.club_id === target.club_id) return existing;
  if (target.registered_player_ids.length >= state.registration_limit) throw new Error(`${target.club_id} registration limit reached`);
  state.registrations[player.tbg_player_id] = {
    player_id: player.tbg_player_id,
    club_id: target.club_id,
    registered: true,
    registered_at: atIso
  };
  if (!target.registered_player_ids.includes(player.tbg_player_id)) target.registered_player_ids.push(player.tbg_player_id);
  event(state, 'player_registered', atIso, { club_id: target.club_id, player_id: player.tbg_player_id });
  return state.registrations[player.tbg_player_id];
}

export function unregisterPlayer(state, { clubId, playerId: idValue, at, reason = 'squad_change' } = {}) {
  const atIso = iso(at);
  const target = club(state, clubId);
  const player = ownedPlayer(state, idValue);
  target.registered_player_ids = target.registered_player_ids.filter((id) => id !== player.tbg_player_id);
  state.registrations[player.tbg_player_id] = {
    player_id: player.tbg_player_id,
    club_id: target.club_id,
    registered: false,
    registered_at: state.registrations[player.tbg_player_id]?.registered_at || null,
    unregistered_at: atIso,
    reason
  };
  event(state, 'player_unregistered', atIso, { club_id: target.club_id, player_id: player.tbg_player_id, reason });
}

export function renewContract(state, { playerId: idValue, clubId, at, endAt, wage } = {}) {
  const atIso = iso(at);
  const player = ownedPlayer(state, idValue);
  if (player.club_id !== text(clubId)) throw new Error(`${player.tbg_player_id} is not owned by ${clubId}`);
  const oldContract = state.contracts[player.contract_id];
  if (oldContract) oldContract.status = 'renewed';
  const contract = {
    contract_id: `${player.tbg_player_id}:${clubId}:${atIso}`,
    player_id: player.tbg_player_id,
    club_id: text(clubId),
    start_at: atIso,
    end_at: iso(endAt),
    wage: Math.max(0, integer(wage, oldContract?.wage || 1000)),
    status: 'active'
  };
  if (new Date(contract.end_at) <= new Date(contract.start_at)) throw new Error('Contract end must be after contract start');
  state.contracts[contract.contract_id] = contract;
  player.contract_id = contract.contract_id;
  event(state, 'contract_renewed', atIso, { club_id: contract.club_id, player_id: player.tbg_player_id, contract_id: contract.contract_id, end_at: contract.end_at });
  return contract;
}

export function transferPlayer(state, {
  playerId: idValue,
  fromClubId,
  toClubId,
  at,
  fee = 0,
  contractEndAt,
  wage
} = {}) {
  const atIso = iso(at);
  const window = activeTransferWindow(state, atIso);
  if (!window) throw new Error(`Transfer window is closed at ${atIso}`);
  const player = ownedPlayer(state, idValue);
  const from = club(state, fromClubId);
  const to = club(state, toClubId);
  if (from.club_id === to.club_id) throw new Error('Transfer requires two different clubs');
  if (player.club_id !== from.club_id || !from.player_ids.includes(player.tbg_player_id)) throw new Error(`${player.tbg_player_id} is not owned by ${from.club_id}`);

  unregisterPlayer(state, { clubId: from.club_id, playerId: player.tbg_player_id, at: atIso, reason: 'transferred' });
  from.player_ids = from.player_ids.filter((id) => id !== player.tbg_player_id);
  to.player_ids.push(player.tbg_player_id);
  player.club_id = to.club_id;
  renewContract(state, {
    playerId: player.tbg_player_id,
    clubId: to.club_id,
    at: atIso,
    endAt: contractEndAt || addDays(state.calendar.season_end, 365 * 3),
    wage
  });
  registerPlayer(state, { clubId: to.club_id, playerId: player.tbg_player_id, at: atIso });
  event(state, 'player_transferred', atIso, {
    player_id: player.tbg_player_id,
    from_club_id: from.club_id,
    to_club_id: to.club_id,
    fee: Math.max(0, integer(fee)),
    window_id: window.window_id
  });
  return player;
}

export function processContractExpiries(state, { at = state.calendar.contract_expiry_at } = {}) {
  const atIso = iso(at);
  const released = [];
  for (const player of Object.values(state.players)) {
    if (!player.club_id || !player.contract_id) continue;
    const contract = state.contracts[player.contract_id];
    if (!contract || contract.status !== 'active' || new Date(contract.end_at) > new Date(atIso)) continue;
    const owner = club(state, player.club_id);
    unregisterPlayer(state, { clubId: owner.club_id, playerId: player.tbg_player_id, at: atIso, reason: 'contract_expired' });
    owner.player_ids = owner.player_ids.filter((id) => id !== player.tbg_player_id);
    contract.status = 'expired';
    player.club_id = null;
    released.push(player.tbg_player_id);
    event(state, 'contract_expired', atIso, { player_id: player.tbg_player_id, former_club_id: owner.club_id, contract_id: contract.contract_id });
  }
  return Object.freeze(released);
}

export function generateYouthIntake(state, {
  clubId,
  at = state.calendar.youth_intake_at,
  count = DEFAULT_YOUTH_INTAKE_SIZE
} = {}) {
  const atIso = iso(at);
  const target = club(state, clubId);
  const positions = ['Goalkeeper', 'Centre-Back', 'Central Midfield', 'Right Winger', 'Centre-Forward', 'Left-Back'];
  const created = [];
  for (let index = 0; index < integer(count, DEFAULT_YOUTH_INTAKE_SIZE); index += 1) {
    const seed = hash(`${state.season_id}:${target.club_id}:${index}`);
    const id = `${target.club_id}-youth-${state.season_id}-${index + 1}`;
    if (state.players[id]) throw new Error(`Youth intake already generated: ${id}`);
    const player = {
      tbg_player_id: id,
      display_name: `${target.club_name} Youth ${index + 1}`,
      club_id: target.club_id,
      age: 16 + (seed % 3),
      position: positions[seed % positions.length],
      underlying_ability_rating: 65 + (seed % 6),
      youth_intake_season: state.season_id
    };
    state.players[id] = player;
    target.player_ids.push(id);
    const contract = {
      contract_id: `${id}:${target.club_id}:academy`,
      player_id: id,
      club_id: target.club_id,
      start_at: atIso,
      end_at: addDays(atIso, 365 * 3),
      wage: 250,
      status: 'active'
    };
    state.contracts[contract.contract_id] = contract;
    player.contract_id = contract.contract_id;
    state.registrations[id] = { player_id: id, club_id: target.club_id, registered: false, registered_at: null };
    created.push(Object.freeze({ ...player }));
    event(state, 'youth_player_created', atIso, { club_id: target.club_id, player_id: id, age: player.age, rating: player.underlying_ability_rating, position: player.position });
  }
  return Object.freeze(created);
}

export function squadCycleSnapshot(state) {
  const clubs = Object.values(state.clubs).map((row) => Object.freeze({
    club_id: row.club_id,
    squad_size: row.player_ids.length,
    registered_size: row.registered_player_ids.length,
    player_ids: Object.freeze([...row.player_ids]),
    registered_player_ids: Object.freeze([...row.registered_player_ids])
  }));
  const activeContracts = Object.values(state.contracts).filter((row) => row.status === 'active');
  const freeAgents = Object.values(state.players).filter((row) => !row.club_id);
  const checks = Object.freeze({
    every_owned_player_appears_once: Object.values(state.players).filter((row) => row.club_id).every((player) => state.clubs[player.club_id]?.player_ids.filter((id) => id === player.tbg_player_id).length === 1),
    registrations_match_ownership: Object.values(state.registrations).every((row) => !row.registered || state.players[row.player_id]?.club_id === row.club_id),
    no_club_exceeds_registration_limit: clubs.every((row) => row.registered_size <= state.registration_limit),
    every_owned_player_has_active_contract: Object.values(state.players).filter((row) => row.club_id).every((player) => state.contracts[player.contract_id]?.status === 'active'),
    event_ids_are_unique: new Set(state.events.map((row) => row.event_id)).size === state.events.length
  });
  return Object.freeze({
    version: SQUAD_CYCLE_VERSION,
    season_id: state.season_id,
    clubs: Object.freeze(clubs),
    player_count: Object.keys(state.players).length,
    active_contract_count: activeContracts.length,
    free_agent_count: freeAgents.length,
    event_count: state.events.length,
    events: Object.freeze([...state.events]),
    checks,
    accepted: Object.values(checks).every(Boolean)
  });
}
