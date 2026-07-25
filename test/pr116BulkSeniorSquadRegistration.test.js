import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildRegistrationDiff, registrationRoster } from '../netlify/functions/bulk-squad-registration.mjs';

test('bulk registration computes only the required roster changes', () => {
  assert.deepEqual(
    buildRegistrationDiff(
      ['player-1', 'player-2', 'player-3'],
      ['player-2', 'player-3', 'player-4'],
      ['player-1', 'player-2', 'player-3', 'player-4'],
      25
    ),
    { unregister: ['player-1'], register: ['player-4'] }
  );
});

test('bulk registration rejects over-limit and unowned selections', () => {
  assert.throws(
    () => buildRegistrationDiff([], ['one', 'two'], ['one', 'two'], 1),
    /limited to 1 players/
  );
  assert.throws(
    () => buildRegistrationDiff([], ['one', 'intruder'], ['one'], 25),
    /not owned by this club: intruder/
  );
});

test('registration roster includes senior players only and preserves current selection', () => {
  const world = {
    squad_cycle: {
      registration_limit: 25,
      clubs: {
        club: {
          player_ids: ['senior', 'youth'],
          registered_player_ids: ['senior', 'youth']
        }
      },
      players: {
        senior: { tbg_player_id: 'senior', display_name: 'Senior Player', age: 22, underlying_ability_rating: 90, specific_position: 'Centre-Back' },
        youth: { tbg_player_id: 'youth', display_name: 'Youth Player', age: 21, underlying_ability_rating: 95, specific_position: 'Forward' }
      }
    }
  };
  assert.deepEqual(registrationRoster(world, 'club'), {
    registration_limit: 25,
    players: [{
      player_id: 'senior',
      display_name: 'Senior Player',
      age: 22,
      position: 'Centre-Back',
      rating: 90,
      registered: true
    }]
  });
});

test('portal submits one atomic pending-aware roster batch', () => {
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const ui = fs.readFileSync(new URL('../public/bulk-squad-registration.js', import.meta.url), 'utf8');
  const endpoint = fs.readFileSync(new URL('../netlify/functions/bulk-squad-registration.mjs', import.meta.url), 'utf8');
  const migration = fs.readFileSync(new URL('../supabase/migrations/20260725_pr116_atomic_bulk_registration.sql', import.meta.url), 'utf8');
  assert.match(html, /bulk-squad-registration\.css/);
  assert.match(html, /bulk-squad-registration\.js/);
  assert.match(ui, /Submit senior squad registration/);
  assert.match(ui, /player_ids: playerIds/);
  assert.match(endpoint, /submit_bulk_registration_commands/);
  assert.doesNotMatch(endpoint, /for \(const id of diff\./);
  assert.match(migration, /status = 'pending'/);
  assert.match(migration, /pending_type = 'unregister_player'/);
  assert.match(migration, /effective_registered is distinct from desired_registered/);
  assert.match(migration, /perform public\.submit_manager_world_command/);
  assert.match(migration, /for phase in 0\.\.1 loop/);
  assert.match(migration, /security definer/);
  assert.match(migration, /grant execute on function public\.submit_bulk_registration_commands/);
});
