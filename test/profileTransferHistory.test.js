import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const endpoint = readFileSync(new URL('../netlify/functions/profile-transfer-history.mjs', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../public/profile-transfer-history.js', import.meta.url), 'utf8');
const clubInspection = readFileSync(new URL('../public/club-inspection.js', import.meta.url), 'utf8');
const profileLinks = readFileSync(new URL('../public/internal-profile-links.js', import.meta.url), 'utf8');

test('profile transfer history only publishes completed canonical moves', () => {
  assert.match(endpoint, /deal\.status !== 'completed'/);
  assert.match(endpoint, /status=eq\.completed/);
  assert.match(endpoint, /get_world_transfer_register_for_user/);
  assert.match(endpoint, /player_acquisitions/);
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