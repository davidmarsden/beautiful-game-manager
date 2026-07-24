import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { selectViableRegistrationIds } from '../src/world/viableCanonicalRegistration.js';
import { positionGroup } from '../src/intelligence/squadIntelligence.js';

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

function players(group, count, startRating = 90) {
  const positions = { goalkeeper: 'GK', defender: 'CB', midfielder: 'CM', attacker: 'CF' };
  return Array.from({ length: count }, (_, index) => ({
    tbg_player_id: `${group}-${index + 1}`,
    position: positions[group],
    age: 24,
    underlying_ability_rating: startRating - index
  }));
}

test('initial registration selection satisfies positional requirements before filling by rating', () => {
  const squad = [
    ...players('attacker', 12, 99),
    ...players('midfielder', 7, 88),
    ...players('defender', 8, 86),
    ...players('goalkeeper', 3, 80)
  ];
  const selected = selectViableRegistrationIds(squad, 25);
  const byId = new Map(squad.map((player) => [player.tbg_player_id, player]));
  const counts = { goalkeeper: 0, defender: 0, midfielder: 0, attacker: 0 };
  for (const id of selected.selected_ids) counts[positionGroup(byId.get(id).position)] += 1;
  assert.equal(selected.selected_ids.length, 25);
  assert.ok(counts.goalkeeper >= 2);
  assert.ok(counts.defender >= 6);
  assert.ok(counts.midfielder >= 5);
  assert.ok(counts.attacker >= 3);
});

test('position-first selection honours publication position aliases', () => {
  const aliasPlayers = [
    { tbg_player_id: 'gk-1', transfermarkt_position: 'Goalkeeper', age: 25, rating: 80 },
    { tbg_player_id: 'gk-2', position_detail: 'Goalkeeper', age: 24, rating: 79 },
    ...Array.from({ length: 6 }, (_, index) => ({ tbg_player_id: `def-${index}`, specific_position: 'Centre-Back', age: 24, rating: 78 - index })),
    ...Array.from({ length: 5 }, (_, index) => ({ tbg_player_id: `mid-${index}`, transfermarkt_position: 'Central Midfield', age: 24, rating: 72 - index })),
    ...Array.from({ length: 3 }, (_, index) => ({ tbg_player_id: `att-${index}`, position_detail: 'Centre-Forward', age: 24, rating: 67 - index }))
  ];
  const selected = selectViableRegistrationIds(aliasPlayers, 16);
  assert.equal(selected.selected_ids.length, 16);
  assert.deepEqual(selected.missing, { goalkeeper: 0, defender: 0, midfielder: 0, attacker: 0 });
});

test('missing owned coverage reserves registration places for free-agent repair', () => {
  const squad = [
    ...players('goalkeeper', 1),
    ...players('defender', 8),
    ...players('midfielder', 8),
    ...players('attacker', 10)
  ];
  const selected = selectViableRegistrationIds(squad, 25);
  assert.equal(selected.missing.goalkeeper, 1);
  assert.equal(selected.reserved_free_agent_places, 1);
  assert.equal(selected.selected_ids.length, 24);
});

test('future canonical worlds use position-first registration rather than publication order', async () => {
  const initializer = await source('src/world/canonicalWorldInitialization.js');
  assert.match(initializer, /selectViableRegistrationIds/);
  assert.doesNotMatch(initializer, /registered: index < registrationLimit/);
  assert.match(initializer, /registeredIds\.has\(playerId\(player\)\)/);
});

test('live repair fills positional gaps and then the senior hard minimum', async () => {
  const repair = await source('src/world/viableCanonicalRegistration.js');
  for (const alias of ['position_detail', 'transfermarkt_position', 'specific_position']) assert.match(repair, new RegExp(alias));
  assert.match(repair, /while \(report\.summary\.hard_minimum_gap > 0/);
  assert.match(repair, /const candidate = nextFreeAgent\(\)/);
});

test('administrator repair is preview-first and checksum-protected', async () => {
  const [endpoint, control] = await Promise.all([
    source('netlify/functions/repair-canonical-registrations.mjs'),
    source('public/admin-turn-control.js')
  ]);
  assert.match(endpoint, /action === 'preview'/);
  assert.match(endpoint, /expected_checksum !== before\.save_checksum/);
  assert.match(endpoint, /p_expected_checksum: before\.save_checksum/);
  assert.match(endpoint, /p_expected_turn_status: before\.turn_status/);
  assert.match(endpoint, /operation_type: 'registration_repair'/);
  assert.match(control, /Preview registration repair/);
  assert.match(control, /Apply previewed repair/);
  assert.match(control, /applyButton\.disabled = !result\.preview\.accepted/);
});

test('repair preview exposes all required administrator evidence', async () => {
  const repair = await source('src/world/viableCanonicalRegistration.js');
  for (const field of ['registrations_added', 'registrations_removed', 'free_agents_signed', 'clubs_still_impossible']) {
    assert.match(repair, new RegExp(field));
  }
  assert.match(repair, /loadPersistentWorld\(savePersistentWorld\(worldInput\)\)/);
});

test('registration repair migration atomically replaces checkpoint and writes audit evidence', async () => {
  const migration = await source('supabase/migrations/20260724_pr105_registration_repair_operation_type.sql');
  const endpoint = await source('netlify/functions/repair-canonical-registrations.mjs');
  assert.match(migration, /world_operation_events_operation_type_check/);
  assert.match(migration, /'registration_repair'/);
  assert.match(migration, /create or replace function public\.apply_canonical_registration_repair/);
  assert.match(migration, /update public\.canonical_world_saves[\s\S]*insert into public\.world_operation_events/);
  assert.match(migration, /security definer/);
  assert.match(endpoint, /\/rest\/v1\/rpc\/apply_canonical_registration_repair/);
  assert.doesNotMatch(endpoint, /method: 'PATCH'/);
});
