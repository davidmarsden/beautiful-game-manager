const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const text = (value) => String(value ?? '').trim();

export const MATCH_STATE_PERSISTENCE_VERSION = 'tbg-match-state-persistence-v0.1';
export const DEFAULT_RECOVERY_PER_DAY = 9;

function timestamp(value) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : null;
}

export function elapsedRestDays(lastPlayedAt, kickoffAt) {
  const previous = timestamp(lastPlayedAt);
  const next = timestamp(kickoffAt);
  if (previous === null || next === null || next <= previous) return 0;
  return (next - previous) / 86400000;
}

export function recoveredFitness(row = {}, fixture = {}, recoveryPerDay = DEFAULT_RECOVERY_PER_DAY) {
  const currentSeason = text(fixture.season_id);
  const storedSeason = text(row.season_id);
  if (storedSeason && currentSeason && storedSeason !== currentSeason) return 100;
  const starting = clamp(number(row.fitness, 100), 0, 100);
  const days = elapsedRestDays(row.last_played_at, fixture.kickoff_at);
  return clamp(starting + days * recoveryPerDay, 0, 100);
}

export function hydrateMatchState({ rows = [], playerIds = [], fixture = {}, recoveryPerDay = DEFAULT_RECOVERY_PER_DAY }) {
  const byId = new Map(rows.map((row) => [text(row.player_id), row]));
  const players = {};

  for (const rawId of playerIds) {
    const playerId = text(rawId);
    if (!playerId || players[playerId]) continue;
    const row = byId.get(playerId) || {};
    const seasonChanged = Boolean(text(row.season_id) && text(fixture.season_id) && text(row.season_id) !== text(fixture.season_id));
    players[playerId] = {
      player_id: playerId,
      fitness: Number(recoveredFitness(row, fixture, recoveryPerDay).toFixed(3)),
      sharpness: clamp(number(row.sharpness, 100), 0, 100),
      morale: clamp(number(row.morale, 50), 0, 100),
      injury_status: seasonChanged ? null : row.injury_status || null,
      suspended: seasonChanged ? false : Boolean(row.suspended),
      yellow_cards: seasonChanged ? 0 : Math.max(0, Math.trunc(number(row.yellow_cards, 0))),
      red_cards: seasonChanged ? 0 : Math.max(0, Math.trunc(number(row.red_cards, 0))),
      last_played_at: row.last_played_at || null,
      season_id: text(fixture.season_id) || text(row.season_id) || null
    };
  }

  return Object.freeze({
    version: MATCH_STATE_PERSISTENCE_VERSION,
    recovery_per_rest_day: recoveryPerDay,
    players: Object.freeze(players)
  });
}

export function buildMatchStateApplication({ fixture = {}, result = {}, runKey = '' }) {
  const stateChanges = result.state_changes || {};
  const fitness = Array.isArray(stateChanges.fitness) ? stateChanges.fitness : [];
  const injuries = new Map((stateChanges.injuries || []).filter((row) => row?.player_id).map((row) => [text(row.player_id), row]));
  const discipline = new Map((stateChanges.discipline || []).filter((row) => row?.player_id).map((row) => [text(row.player_id), row]));

  const players = fitness.map((row) => {
    const playerId = text(row.player_id);
    if (!playerId) throw new Error('Persistent match state requires player_id for every fitness change');
    const injury = injuries.get(playerId);
    const card = discipline.get(playerId) || {};
    return Object.freeze({
      player_id: playerId,
      side: row.side || null,
      starting_fitness: clamp(number(row.starting_fitness, 100), 0, 100),
      post_match_fitness: clamp(number(row.projected_post_match_fitness, row.starting_fitness), 0, 100),
      injury_status: injury?.status || null,
      yellow_cards: Math.max(0, Math.trunc(number(card.yellow_cards, 0))),
      red_cards: Math.max(0, Math.trunc(number(card.red_cards, 0))),
      sent_off: Boolean(card.sent_off),
      dismissal_type: card.dismissal_type || null
    });
  });

  const applicationKey = text(runKey || result.run_key || `${fixture.world_id || ''}:${fixture.id || fixture.fixture_id || ''}`);
  if (!applicationKey) throw new Error('Persistent match state requires a run key');

  return Object.freeze({
    version: MATCH_STATE_PERSISTENCE_VERSION,
    run_key: applicationKey,
    fixture_id: text(fixture.id || fixture.fixture_id),
    world_id: text(fixture.world_id),
    season_id: text(fixture.season_id),
    played_at: result.played_at || fixture.played_at || fixture.kickoff_at || null,
    players: Object.freeze(players)
  });
}

export function applyApplicationInMemory({ rows = [], appliedRunKeys = new Set(), application }) {
  if (!application?.run_key) throw new Error('Application run key is required');
  const existing = new Map(rows.map((row) => [text(row.player_id), { ...row }]));
  if (appliedRunKeys.has(application.run_key)) {
    return { applied: false, rows: [...existing.values()], appliedRunKeys: new Set(appliedRunKeys) };
  }

  for (const change of application.players || []) {
    const current = existing.get(change.player_id) || { player_id: change.player_id, fitness: 100, sharpness: 100, morale: 50, yellow_cards: 0, red_cards: 0 };
    const sameSeason = !current.season_id || current.season_id === application.season_id;
    existing.set(change.player_id, {
      ...current,
      world_id: application.world_id,
      season_id: application.season_id,
      fitness: change.post_match_fitness,
      injury_status: change.injury_status || (sameSeason ? current.injury_status || null : null),
      yellow_cards: (sameSeason ? number(current.yellow_cards, 0) : 0) + change.yellow_cards,
      red_cards: (sameSeason ? number(current.red_cards, 0) : 0) + change.red_cards,
      suspended: Boolean(change.sent_off || (sameSeason && current.suspended)),
      last_played_at: application.played_at,
      last_run_key: application.run_key
    });
  }

  const nextKeys = new Set(appliedRunKeys);
  nextKeys.add(application.run_key);
  return { applied: true, rows: [...existing.values()], appliedRunKeys: nextKeys };
}
