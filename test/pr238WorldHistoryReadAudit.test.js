import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildWorldReadModel } from '../src/world/worldReadModel.js';

const historyUrl = new URL('../netlify/functions/history.mjs', import.meta.url);
const roundsUrl = new URL('../netlify/functions/competition-rounds.mjs', import.meta.url);
const linkedUrl = new URL('../netlify/functions/match-centre-linked.mjs', import.meta.url);
const migrationUrl = new URL('../supabase/migrations/20260817_world_read_model_cache.sql', import.meta.url);

test('manager-facing History, Competition and linked Match Centre no longer read canonical save_envelope', async () => {
  const [history, rounds, linked] = await Promise.all([
    readFile(historyUrl, 'utf8'),
    readFile(roundsUrl, 'utf8'),
    readFile(linkedUrl, 'utf8')
  ]);
  for (const source of [history, rounds, linked]) {
    assert.doesNotMatch(source, /canonical_world_saves[^\n]*save_envelope/i);
    assert.doesNotMatch(source, /select=save_envelope/i);
  }
  assert.match(history, /world_read_model_cache/);
  assert.match(rounds, /world_read_model_cache/);
  assert.match(linked, /get_world_player_identity_directory/);
});

test('World read model preserves the fields required by History and Competition while excluding operational envelopes', () => {
  const world = {
    world_id: 'world-1', display_name: 'TBG', season_number: 1, phase: 'season', clock: { now: '2026-08-17' },
    club_profiles: { c1: { club_name: 'Club One' } },
    competition: { divisions: [{ division_id: 'd1', level: 1, club_ids: ['c1'] }], movement_history: [{ club_id: 'c1' }] },
    squad_cycle: {
      season_id: 'season-1', registration_limit: 40,
      clubs: { c1: { player_ids: ['p1'], registered_player_ids: ['p1'] } },
      players: { p1: { tbg_player_id: 'p1', display_name: 'Player One', rating: 90, contract_id: 'ct1' } },
      contracts: { ct1: { end_at: '2028-06-30' } },
      state: { registrations: { p1: true } },
      finance: { enormous_unneeded_branch: true }
    },
    matchday_cycle: {
      season_id: 'season-1', current_matchday: 8, maximum_matchday: 38, turn_calendar: { hour_utc: 19 },
      runtimes: { d1: { fixtures: [{ fixture_id: 'f1' }], table: { c1: { club_id: 'c1', points: 3 } }, archive_results: [], results: [], state: { players: { p1: { fitness: 91 } }, availability: { players: { p1: {} } }, applied_run_keys: ['f1'], hidden_runtime_data: 'drop-me' } } }
    },
    history: { archives: [{ archive_id: 'a1' }], internal_history_state: 'drop-me' },
    completed_seasons: [{ season_id: 'season-0' }],
    manager_commands: [{ huge: true }],
    transfer_cycle: { huge: true }
  };
  const model = buildWorldReadModel(world);
  assert.equal(model.world_id, 'world-1');
  assert.equal(model.squad_cycle.players.p1.display_name, 'Player One');
  assert.equal(model.matchday_cycle.runtimes.d1.state.players.p1.fitness, 91);
  assert.deepEqual(model.history.archives, [{ archive_id: 'a1' }]);
  assert.equal(model.squad_cycle.finance, undefined);
  assert.equal(model.manager_commands, undefined);
  assert.equal(model.transfer_cycle, undefined);
  assert.equal(model.matchday_cycle.runtimes.d1.hidden_runtime_data, undefined);
});

test('read-model cache is service-only and exposes only a player-directory RPC for linked Match Centre', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /alter table public\.world_read_model_cache enable row level security/i);
  assert.match(sql, /revoke all on table public\.world_read_model_cache from anon, authenticated/i);
  assert.match(sql, /get_world_player_identity_directory/);
  assert.match(sql, /revoke all on function public\.get_world_player_identity_directory\(text\) from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.get_world_player_identity_directory\(text\) to service_role/i);
});
