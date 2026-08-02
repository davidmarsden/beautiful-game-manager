import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { resolveLineupEvents } from '../src/matchEngine/LineupResolution.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const starters = (side) => [
  { player_id: `${side}-gk`, required_role: 'gk', actual_role: 'gk', effective_quality: 90 },
  { player_id: `${side}-fb1`, required_role: 'fb', actual_role: 'fb', effective_quality: 88 },
  { player_id: `${side}-cb1`, required_role: 'cb', actual_role: 'cb', effective_quality: 89 },
  { player_id: `${side}-cb2`, required_role: 'cb', actual_role: 'cb', effective_quality: 87 },
  { player_id: `${side}-fb2`, required_role: 'fb', actual_role: 'fb', effective_quality: 86 },
  { player_id: `${side}-dm`, required_role: 'dm', actual_role: 'dm', effective_quality: 85 },
  { player_id: `${side}-cm1`, required_role: 'cm', actual_role: 'cm', effective_quality: 84 },
  { player_id: `${side}-cm2`, required_role: 'cm', actual_role: 'cm', effective_quality: 83 },
  { player_id: `${side}-wing1`, required_role: 'wing', actual_role: 'wing', effective_quality: 82 },
  { player_id: `${side}-st`, required_role: 'st', actual_role: 'st', effective_quality: 81 },
  { player_id: `${side}-wing2`, required_role: 'wing', actual_role: 'wing', effective_quality: 80 }
];

const bench = (side) => [
  { player_id: `${side}-bench-gk`, actual_role: 'gk', effective_quality: 99 },
  { player_id: `${side}-bench-cm`, actual_role: 'cm', effective_quality: 78 },
  { player_id: `${side}-bench-wing`, actual_role: 'wing', effective_quality: 77 },
  { player_id: `${side}-bench-st`, actual_role: 'st', effective_quality: 76 }
];

function quality() {
  return {
    home: { starters: starters('home'), bench: { players: bench('home') } },
    away: { starters: starters('away'), bench: { players: bench('away') } }
  };
}

function contract() {
  return {
    teams: {
      home: { starting_xi: starters('home').map((row) => row.player_id), bench: bench('home').map((row) => row.player_id) },
      away: { starting_xi: starters('away').map((row) => row.player_id), bench: bench('away').map((row) => row.player_id) }
    }
  };
}

test('tactical substitutions never introduce a goalkeeper into an outfield role', () => {
  const result = resolveLineupEvents({ provisional_event_stream: [] }, contract(), quality());
  const tactical = result.events.filter((event) => event.side === 'home' && event.type === 'substitution');
  assert.ok(tactical.length > 0);
  assert.equal(tactical.some((event) => event.player_in_id === 'home-bench-gk'), false);
  assert.equal(result.lineups.home.final_on_pitch.includes('home-bench-gk'), false);
});

test('goalkeeper injuries use a goalkeeper replacement when one is available', () => {
  const result = resolveLineupEvents({
    provisional_event_stream: [{ event_id: 'home-gk-injury', minute: 20, side: 'home', type: 'injury', player_id: 'home-gk' }]
  }, contract(), quality());
  const replacement = result.events.find((event) => event.type === 'substitution' && event.reason === 'injury');
  assert.equal(replacement.player_out_id, 'home-gk');
  assert.equal(replacement.player_in_id, 'home-bench-gk');
});

test('match archive projection exposes substitution identities and lineup minutes', async () => {
  const endpoint = await read('netlify/functions/match-centre.mjs');
  assert.match(endpoint, /event\.player_in_id/);
  assert.match(endpoint, /event\.player_out_id/);
  assert.match(endpoint, /player_in_name: inName/);
  assert.match(endpoint, /player_out_name: outName/);
  assert.match(endpoint, /function substitutionTimeline/);
  assert.match(endpoint, /on_minute/);
  assert.match(endpoint, /off_minute/);
});

test('lineup report shows substitutions, goals, cards and ratings beside players', async () => {
  const client = await read('public/phase2d4.js');
  assert.match(client, /const substitutionBadge/);
  assert.match(client, /↑ \$\{mcNumber\(substitution\.on_minute\)\}/);
  assert.match(client, /↓ \$\{mcNumber\(substitution\.off_minute\)\}/);
  assert.match(client, /performanceBadges\(player\.performance\)/);
  assert.match(client, /ratingBadge\(player\.performance\?\.rating\)/);
  assert.match(client, /player_out_name \|\| 'Unknown player'/);
  assert.match(client, /player_in_name \|\| 'Unknown player'/);
});
