import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const endpoint = readFileSync(new URL('../netlify/functions/profile-transfer-history.mjs', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../public/profile-transfer-history.js', import.meta.url), 'utf8');
const clubInspection = readFileSync(new URL('../public/club-inspection.js', import.meta.url), 'utf8');
const profileLinks = readFileSync(new URL('../public/internal-profile-links.js', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/20260908_profile_transfer_history.sql', import.meta.url), 'utf8');

test('profile transfer history is filtered in SQL before any world-wide cap', () => {
  assert.match(endpoint, /get_profile_transfer_history_for_user/);
  assert.doesNotMatch(endpoint, /get_world_transfer_register_for_user/);
  assert.match(migration, /deal\.status = 'completed'/);
  assert.match(migration, /player_leg\.player_id = p_player_id/);
  assert.match(migration, /player_leg\.from_club_id = p_club_id/);
  assert.match(migration, /player_leg\.to_club_id = p_club_id/);
});

test('external acquisitions preserve governed EUR fees', () => {
  assert.match(migration, /external_acquisition_fee_eur/);
  assert.match(migration, /'EUR'/);
  assert.match(ui, /event\.fee_currency/);
  assert.match(ui, /Intl\.NumberFormat/);
});

test('player profiles replace the dormant Transfers tab with ledger history', () => {
  assert.match(profileLinks, /import '\.\/profile-transfer-history\.js'/);
  assert.match(ui, /data-player-tab="transfers"/);
  assert.match(ui, /player_id/);
  assert.match(ui, /Completed TBG moves only/);
});

test('club inspection shows arrivals and departures with linked players and clubs', () => {
  assert.match(clubInspection, /mountClubTransferHistory/);
  assert.match(ui, /Arrivals & departures/);
  assert.match(ui, /data-player-profile-id/);
  assert.match(ui, /data-club-id/);
  assert.match(ui, /Arrival/);
  assert.match(ui, /Departure/);
});

test('following a club link from player transfer history closes the player modal first', () => {
  assert.match(ui, /transfer-profile-club-link/);
  assert.match(ui, /closest\('\[data-tbg-player-profile-host\]'\)/);
  assert.match(ui, /playerModal\.remove\(\)/);
});