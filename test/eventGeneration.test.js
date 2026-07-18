import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngineContext } from '../src/matchEngine/EngineContext.js';
import { executeTacticalResolution } from '../src/matchEngine/modules/TacticalResolution.js';
import { executePlayerQuality } from '../src/matchEngine/modules/PlayerQuality.js';
import { executeFatigueContext } from '../src/matchEngine/modules/FatigueContext.js';
import {
  EVENT_GENERATION_STATE_KEY,
  EVENT_GENERATION_VERSION,
  executeEventGeneration,
  resolveEventGeneration
} from '../src/matchEngine/modules/EventGeneration.js';

const positions = ['Goalkeeper','Right-Back','Centre-Back','Centre-Back','Left-Back','Defensive Midfield','Central Midfield','Central Midfield','Right Winger','Centre-Forward','Left Winger'];
const ids = (prefix) => positions.map((_, index) => `${prefix}-${index + 1}`);
const homeIds = ids('home');
const awayIds = ids('away');

function contract(overrides = {}) {
  return {
    run_key: 'event-generation-test',
    fixture: { fixture_id: 'fixture-event-generation', season: 1, round: 4, date: '2026-07-18' },
    teams: {
      home: { side: 'home', club_id: 'home-club', formation: '4-3-3-wide', starting_xi: homeIds, bench: [], tactics: { mentality: 'attacking', pressing: 'high', tempo: 'fast', width: 'wide' } },
      away: { side: 'away', club_id: 'away-club', formation: '5-3-2', starting_xi: awayIds, bench: [], tactics: { mentality: 'cautious', pressing: 'low', tempo: 'slow', width: 'narrow' } }
    },
    ...overrides
  };
}

function world(homeRating = 92, awayRating = 87) {
  return {
    players: [
      ...homeIds.map((id, index) => ({ tbg_player_id: id, display_name: id, position: positions[index], underlying_ability_rating: homeRating, work_rate: 70 })),
      ...awayIds.map((id, index) => ({ tbg_player_id: id, display_name: id, position: positions[index], underlying_ability_rating: awayRating, work_rate: 55 }))
    ]
  };
}

function buildContext(inputContract = contract(), inputWorld = world()) {
  const context = createEngineContext({ contract: inputContract, world: inputWorld });
  executeTacticalResolution(context);
  executePlayerQuality(context);
  executeFatigueContext(context);
  executeEventGeneration(context);
  return context;
}

test('generates expected performance and a deterministic provisional event stream', () => {
  const first = buildContext().get(EVENT_GENERATION_STATE_KEY);
  const second = buildContext().get(EVENT_GENERATION_STATE_KEY);

  assert.equal(first.version, EVENT_GENERATION_VERSION);
  assert.deepEqual(first, second);
  assert.ok(first.expected.home.expected_chances > 0);
  assert.ok(first.expected.away.expected_chances > 0);
  assert.ok(first.expected.home.expected_goals >= 0.15 && first.expected.home.expected_goals <= 3.8);
  assert.ok(first.expected.away.expected_goals >= 0.15 && first.expected.away.expected_goals <= 3.8);
  assert.ok(first.provisional_event_stream.every((event, index, events) => index === 0 || event.minute >= events[index - 1].minute));
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.provisional_event_stream));
});

test('stronger attacking quality and favourable tactics raise expected performance', () => {
  const strong = buildContext(contract(), world(94, 84)).get(EVENT_GENERATION_STATE_KEY);
  const level = buildContext(contract(), world(89, 89)).get(EVENT_GENERATION_STATE_KEY);

  assert.ok(strong.expected.home.expected_goals > level.expected.home.expected_goals);
  assert.ok(strong.expected.home.attack_share > level.expected.home.attack_share);
});

test('seed commitment and event stream change when the fixture seed changes', () => {
  const first = buildContext().get(EVENT_GENERATION_STATE_KEY);
  const changedContract = contract({
    run_key: 'event-generation-test-2',
    fixture: { fixture_id: 'fixture-event-generation-2', season: 1, round: 5, date: '2026-07-25' },
    teams: contract().teams
  });
  const second = buildContext(changedContract).get(EVENT_GENERATION_STATE_KEY);

  assert.notEqual(first.seed_commitment, second.seed_commitment);
  assert.notDeepEqual(first.provisional_event_stream, second.provisional_event_stream);
});

test('creates chances, goals, cards, set pieces and commentary hooks without publishing a result', () => {
  const result = buildContext().get(EVENT_GENERATION_STATE_KEY);
  assert.ok(result.event_counts.chances > 0);
  assert.ok(result.event_counts.cards >= 0);
  assert.ok(result.event_counts.set_pieces >= 0);
  assert.ok(result.event_counts.goals >= 0);
  assert.ok(result.commentary_hooks.length <= 12);
  assert.equal(result.score_resolution_pending, true);
  assert.equal(result.applied_to_public_result, false);
  assert.equal(result.state_updates_projected_only, true);
});

test('requires Modules A, B and C rather than inventing missing inputs', () => {
  assert.throws(() => resolveEventGeneration(contract(), null, {}, {}), /requires Module A/);
  assert.throws(() => resolveEventGeneration(contract(), { home: {}, away: {} }, null, {}), /requires Module B/);
  assert.throws(() => resolveEventGeneration(contract(), { home: {}, away: {} }, { home: {}, away: {} }, null), /requires Module C/);
});
