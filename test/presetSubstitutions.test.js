import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolveLineupEvents } from '../src/matchEngine/LineupResolution.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

function player(id, role, quality = 80) {
  return { player_id: id, required_role: role, actual_role: role, effective_quality: quality };
}

function side(prefix) {
  const starters = [
    player(`${prefix}-gk`, 'gk', 82),
    player(`${prefix}-cb1`, 'cb', 81), player(`${prefix}-cb2`, 'cb', 80),
    player(`${prefix}-fb1`, 'fb', 79), player(`${prefix}-fb2`, 'fb', 79),
    player(`${prefix}-dm`, 'dm', 81), player(`${prefix}-cm1`, 'cm', 82), player(`${prefix}-cm2`, 'cm', 80),
    player(`${prefix}-wing1`, 'wing', 83), player(`${prefix}-wing2`, 'wing', 82), player(`${prefix}-st`, 'st', 84)
  ];
  const bench = [
    player(`${prefix}-bgk`, 'gk', 75), player(`${prefix}-bcb`, 'cb', 76), player(`${prefix}-bfb`, 'fb', 76),
    player(`${prefix}-bcm`, 'cm', 78), player(`${prefix}-bam`, 'am', 79), player(`${prefix}-bwing`, 'wing', 80), player(`${prefix}-bst`, 'st', 80)
  ];
  return { starters, bench: { players: bench } };
}

function contract(homePlans = []) {
  const home = side('h');
  const away = side('a');
  return {
    contract: {
      teams: {
        home: {
          starting_xi: home.starters.map((row) => row.player_id),
          bench: home.bench.players.map((row) => row.player_id),
          match_plans: homePlans
        },
        away: {
          starting_xi: away.starters.map((row) => row.player_id),
          bench: away.bench.players.map((row) => row.player_id),
          match_plans: []
        }
      }
    },
    quality: { home, away }
  };
}

test('manager preset substitution executes at the planned minute with exact players', () => {
  const { contract: matchContract, quality } = contract([{
    plan_id: 'protect-midfield', minute: 55, player_out_id: 'h-cm2', player_in_id: 'h-bcm', score_state: 'always'
  }]);
  const result = resolveLineupEvents({ seed_commitment: 'preset-1', provisional_event_stream: [] }, matchContract, quality);
  const planned = result.events.find((event) => event.type === 'substitution' && event.reason === 'manager_plan');
  assert.ok(planned);
  assert.equal(planned.minute, 55);
  assert.equal(planned.player_out_id, 'h-cm2');
  assert.equal(planned.player_in_id, 'h-bcm');
  assert.equal(planned.plan_id, 'protect-midfield');
  assert.ok(result.lineups.home.players_used.includes('h-bcm'));
});

test('score-state condition is evaluated from the match state before the planned minute', () => {
  const { contract: matchContract, quality } = contract([{
    plan_id: 'chase-game', minute: 55, player_out_id: 'h-cm2', player_in_id: 'h-bst', score_state: 'losing'
  }]);
  const events = [{ event_id: 'home-goal-30', minute: 30, side: 'home', type: 'goal', player_id: 'h-st', subtype: 'open_play', outcome: 'goal' }];
  const result = resolveLineupEvents({ seed_commitment: 'preset-2', provisional_event_stream: events }, matchContract, quality);
  assert.equal(result.events.some((event) => event.reason === 'manager_plan' && event.plan_id === 'chase-game'), false);
});

test('multiple same-minute preset substitutions execute in saved order and count toward the five-sub limit', () => {
  const { contract: matchContract, quality } = contract([
    { plan_id: 'one', minute: 65, player_out_id: 'h-cm1', player_in_id: 'h-bcm', score_state: 'always' },
    { plan_id: 'two', minute: 65, player_out_id: 'h-wing1', player_in_id: 'h-bwing', score_state: 'always' }
  ]);
  const result = resolveLineupEvents({ seed_commitment: 'preset-3', provisional_event_stream: [] }, matchContract, quality);
  const planned = result.events.filter((event) => event.reason === 'manager_plan');
  assert.deepEqual(planned.map((event) => event.plan_id), ['one', 'two']);
  assert.ok(result.lineups.home.substitutions.length <= 5);
});

test('preset substitution becomes a safe skip when the named player is no longer active', () => {
  const { contract: matchContract, quality } = contract([{
    plan_id: 'injured-out', minute: 55, player_out_id: 'h-cm2', player_in_id: 'h-bst', score_state: 'always'
  }]);
  const events = [{ event_id: 'injury-40', minute: 40, side: 'home', type: 'injury', player_id: 'h-cm2' }];
  const result = resolveLineupEvents({ seed_commitment: 'preset-4', provisional_event_stream: events }, matchContract, quality);
  assert.equal(result.events.some((event) => event.reason === 'manager_plan' && event.plan_id === 'injured-out'), false);
  assert.ok(result.events.some((event) => event.type === 'substitution' && event.reason === 'injury'));
});

test('manager submission carries the exact seven-player bench and match plans into the engine contract', async () => {
  const source = await read('src/matchEngine/incrementalSeasonSimulation.js');
  assert.match(source, /bench: instruction\.bench \? instruction\.bench\.map\(text\) : null/);
  assert.match(source, /match_plans: normalizeMatchPlans\(instruction\.match_plans \|\| \[\]\)/);
  assert.match(source, /team\.bench = \[\.\.\.normalized\.bench\]/);
  assert.match(source, /team\.match_plans = clone\(normalized\.match_plans\)/);
});

test('Team Selection planner is pre-match, conditional, canonical and reloadable', async () => {
  const ui = await read('public/preset-substitutions.js');
  const save = await read('public/team-selection-submission-reliability.js');
  const api = await read('netlify/functions/decisions.mjs');
  assert.match(ui, /The engine attempts them automatically when the condition is true/);
  assert.match(ui, /\['winning', 'If winning'\]/);
  assert.match(ui, /\['drawing', 'If drawing'\]/);
  assert.match(ui, /\['losing', 'If losing'\]/);
  assert.match(ui, /submission\?\.match_plans \|\| submission\?\.instruction\?\.match_plans/);
  assert.match(save, /match_plans: presetMatchPlans\(\)/);
  assert.match(save, /sameMatchPlans\(matchPlans, payload\.match_plans\)/);
  assert.match(api, /match_plans: matchPlans/);
  assert.match(api, /A maximum of five preset substitutions may be saved/);
});