import { activeTransferWindow, isYouthSquadPlayer, registerPlayer } from './squadCycle.js';

const text = (value) => String(value ?? '').trim();
const integer = (value, fallback = 0) => Number.isInteger(Number(value)) ? Number(value) : fallback;
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

function iso(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid date: ${value}`);
  return date.toISOString();
}

function addDays(value, days) {
  return new Date(new Date(value).getTime() + days * 86400000).toISOString();
}

function playerId(player) {
  return text(player?.tbg_player_id || player?.player_id || player?.id);
}

function clonePlayer(player = {}) {
  const id = playerId(player);
  if (!id) throw new Error('Free-agent acquisition requires a canonical TBG player ID');
  return {
    ...player,
    tbg_player_id: id,
    display_name: text(player.display_name || player.name || id),
    age: integer(player.age, 24),
    underlying_ability_rating: clamp(number(player.underlying_ability_rating ?? player.tbg_rating ?? player.rating, 75), 1, 100),
    transfermarkt_id: text(player.transfermarkt_id || player.transfermarktId)
  };
}

function squadCohort(player) {
  return isYouthSquadPlayer(player) ? 'youth' : 'first_team';
}

function assertSquadCapacity(state, target, player) {
  const cohort = squadCohort(player);
  const limit = Number(state?.squad_limits?.[cohort] ?? 25);
  const count = (target.player_ids || []).reduce((total, id) => {
    const owned = state.players[id];
    return total + (owned && squadCohort(owned) === cohort ? 1 : 0);
  }, 0);
  if (count >= limit) {
    const label = cohort === 'youth' ? 'youth' : 'first-team';
    throw new Error(`${target.club_id} ${label} squad limit reached (${limit})`);
  }
}

function buildContract({ player, clubId, atIso, endAt, wage }) {
  const endIso = iso(endAt);
  if (new Date(endIso) <= new Date(atIso)) throw new Error('Contract end must be after contract start');
  return {
    contract_id: `${player.tbg_player_id}:${clubId}:${atIso}`,
    player_id: player.tbg_player_id,
    club_id: clubId,
    start_at: atIso,
    end_at: endIso,
    wage: Math.max(0, integer(wage, 1000)),
    status: 'active'
  };
}

function event(state, type, at, payload = {}) {
  const row = Object.freeze({
    event_id: `${state.season_id}:${String(state.events.length + 1).padStart(4, '0')}:${type}`,
    type,
    at,
    ...payload
  });
  state.events.push(row);
  return row;
}

export function acquireFreeAgent(state, { player: sourcePlayer, toClubId, at, contractEndAt, wage } = {}) {
  const atIso = iso(at);
  if (!activeTransferWindow(state, atIso)) throw new Error(`Transfer window is closed at ${atIso}`);
  const target = state?.clubs?.[text(toClubId)];
  if (!target) throw new Error(`Unknown club: ${toClubId}`);

  const player = clonePlayer(sourcePlayer);
  if (state.players[player.tbg_player_id]) throw new Error(`${player.tbg_player_id} already exists in the world`);
  if (text(sourcePlayer?.club_id || sourcePlayer?.tbg_club_id)) throw new Error(`${player.tbg_player_id} is not a free agent`);
  assertSquadCapacity(state, target, player);

  const contract = buildContract({
    player,
    clubId: target.club_id,
    atIso,
    endAt: contractEndAt || addDays(state.calendar.season_end, 365 * 3),
    wage
  });

  // Mutate only after all pure validation above has passed. registerPlayer remains
  // the canonical registration-cap/deadline guard and will roll through the same
  // squad-cycle event model as club-to-club transfers.
  player.club_id = target.club_id;
  state.players[player.tbg_player_id] = player;
  target.player_ids.push(player.tbg_player_id);
  state.contracts[contract.contract_id] = contract;
  player.contract_id = contract.contract_id;

  try {
    registerPlayer(state, { clubId: target.club_id, playerId: player.tbg_player_id, at: atIso });
  } catch (error) {
    target.player_ids = target.player_ids.filter((id) => id !== player.tbg_player_id);
    delete state.players[player.tbg_player_id];
    delete state.contracts[contract.contract_id];
    throw error;
  }

  event(state, 'free_agent_signed', atIso, {
    club_id: target.club_id,
    player_id: player.tbg_player_id,
    transfermarkt_id: player.transfermarkt_id,
    contract_id: contract.contract_id
  });

  return { player, contract, registration: state.registrations[player.tbg_player_id] };
}
