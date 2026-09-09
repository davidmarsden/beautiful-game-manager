import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createEngineContext } from '../src/matchEngine/EngineContext.js';
import { executeTacticalResolution } from '../src/matchEngine/modules/TacticalResolution.js';
import { executePlayerQuality } from '../src/matchEngine/modules/PlayerQuality.js';
import { executeFatigueContext } from '../src/matchEngine/modules/FatigueContext.js';
import { executeEventGeneration, EVENT_GENERATION_STATE_KEY } from '../src/matchEngine/modules/EventGeneration.js';

const positions = ['Goalkeeper','Right-Back','Centre-Back','Centre-Back','Left-Back','Defensive Midfield','Central Midfield','Central Midfield','Right Winger','Centre-Forward','Left Winger'];
const ids = (prefix) => positions.map((_, index) => `${prefix}-${index + 1}`);
const homeIds = ids('home');
const awayIds = ids('away');

function world() {
  return { players: [
    ...homeIds.map((id, index) => ({ tbg_player_id: id, display_name: id, position: positions[index], underlying_ability_rating: 90, work_rate: 65 })),
    ...awayIds.map((id, index) => ({ tbg_player_id: id, display_name: id, position: positions[index], underlying_ability_rating: 90, work_rate: 65 }))
  ] };
}

function contract(seed, homeStyle = 'possession', awayStyle = 'low_block') {
  return {
    run_key: `stat-variance-${seed}`,
    fixture: { fixture_id: `stat-variance-${seed}`, season: 1, round: seed, date: '2026-09-09' },
    teams: {
      home: { side: 'home', club_id: 'home', formation: '4-2-3-1', starting_xi: homeIds, bench: [], tactics: { style: homeStyle, route_to_goal: 'balanced', tempo: 'normal' } },
      away: { side: 'away', club_id: 'away', formation: '4-2-3-1', starting_xi: awayIds, bench: [], tactics: { style: awayStyle, route_to_goal: 'balanced', tempo: 'normal' } }
    }
  };
}

function generate(seed, homeStyle, awayStyle) {
  const context = createEngineContext({ contract: contract(seed, homeStyle, awayStyle), world: world() });
  executeTacticalResolution(context);
  executePlayerQuality(context);
  executeFatigueContext(context);
  executeEventGeneration(context);
  return context.get(EVENT_GENERATION_STATE_KEY);
}

const shotRows = (result, side) => result.provisional_event_stream.filter((event) => event.side === side && ['shot', 'big_chance', 'goal'].includes(event.type));

test('committed tactical styles materially move control for otherwise level teams', () => {
  const result = generate(1, 'possession', 'low_block');
  assert.ok(result.expected.home.control_share >= 0.56, `expected possession side above 56%, got ${result.expected.home.control_share}`);
  assert.ok(result.expected.away.control_share <= 0.44, `expected low block below 44%, got ${result.expected.away.control_share}`);
});

test('possession is a deterministic 90-minute trajectory rather than a static final number', () => {
  const first = generate(2, 'possession', 'counter_transition');
  const second = generate(2, 'possession', 'counter_transition');
  assert.deepEqual(first.control_trajectory, second.control_trajectory);
  assert.equal(first.control_trajectory[0].minute, 0);
  assert.equal(first.control_trajectory.at(-1).minute, 90);
  assert.equal(first.control_trajectory.length, 19);
  assert.ok(first.control_trajectory.every((point) => point.home + point.away === 100));
  assert.ok(new Set(first.control_trajectory.map((point) => point.home)).size > 1);
});

test('shot volume has match-to-match dispersion and away shots are not forced on target', () => {
  const totals = [];
  let awayOffTargetMatches = 0;
  for (let seed = 10; seed < 50; seed += 1) {
    const result = generate(seed, 'balanced', 'balanced');
    const homeShots = shotRows(result, 'home');
    const awayShots = shotRows(result, 'away');
    totals.push(homeShots.length);
    if (awayShots.some((event) => event.on_target !== true)) awayOffTargetMatches += 1;
  }
  assert.ok(new Set(totals).size >= 6, `expected dispersed shot counts, got ${[...new Set(totals)].join(', ')}`);
  assert.ok(awayOffTargetMatches >= 20, `away attacks looked implausibly accurate in ${40 - awayOffTargetMatches} matches`);
});

test('Match Centre preserves and renders the replay possession trajectory without self-triggering observer writes', () => {
  const guard = readFileSync(new URL('../public/match-centre-runtime-guard.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../public/match-centre-major-events.css', import.meta.url), 'utf8');
  assert.match(guard, /control_trajectory/);
  assert.match(guard, /replayPossession/);
  assert.match(guard, /MutationObserver/);
  assert.match(guard, /score\.textContent !== scoreText/);
  assert.match(guard, /home\.style\.width !== width/);
  assert.match(guard, /track\.getAttribute\('aria-label'\) !== ariaLabel/);
  assert.match(css, /\.replay-possession-track/);
  assert.match(css, /\.replay-possession-home/);
});