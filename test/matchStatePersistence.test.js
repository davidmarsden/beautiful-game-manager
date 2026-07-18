import test from 'node:test';
import assert from 'node:assert/strict';
import { simulateMatch } from '../src/matchSimulation.js';
import {
  applyApplicationInMemory,
  buildMatchStateApplication,
  elapsedRestDays,
  hydrateMatchState,
  recoveredFitness
} from '../src/matchEngine/MatchStatePersistence.js';

const positions = ['Goalkeeper','Right-Back','Centre-Back','Centre-Back','Left-Back','Defensive Midfield','Central Midfield','Central Midfield','Right Winger','Centre-Forward','Left Winger'];
const ids = (prefix) => positions.map((_, index) => `${prefix}-${index + 1}`);
const homeIds = ids('home');
const awayIds = ids('away');
const players = [
  ...homeIds.map((id, index) => ({ tbg_player_id: id, display_name: id, position: positions[index], underlying_ability_rating: 90, work_rate: 60 })),
  ...awayIds.map((id, index) => ({ tbg_player_id: id, display_name: id, position: positions[index], underlying_ability_rating: 89, work_rate: 60 }))
];
const world = { world_id: 'world-1', active_season_id: 'season-1', players };

function contract(fixtureId, kickoffAt, matchState = null) {
  return {
    contract_version: '2d2-v1',
    engine_mode: 'constitutional-v1',
    run_key: `world-1:${fixtureId}`,
    fixture: {
      fixture_id: fixtureId,
      world_id: 'world-1',
      season_id: 'season-1',
      kickoff_at: kickoffAt,
      home_club_id: 'home-club',
      away_club_id: 'away-club'
    },
    teams: {
      home: { side: 'home', club_id: 'home-club', formation: '4-3-3-wide', starting_xi: homeIds, bench: [], tactics: { mentality: 'balanced', pressing: 'high', tempo: 'fast' } },
      away: { side: 'away', club_id: 'away-club', formation: '4-3-3-wide', starting_xi: awayIds, bench: [], tactics: { mentality: 'balanced', pressing: 'mid', tempo: 'normal' } }
    },
    ...(matchState ? { match_state: matchState } : {})
  };
}

test('recovery uses elapsed rest time and is capped at 100', () => {
  assert.equal(elapsedRestDays('2026-07-01T15:00:00Z', '2026-07-03T15:00:00Z'), 2);
  assert.equal(recoveredFitness({ fitness: 70, season_id: 's1', last_played_at: '2026-07-01T15:00:00Z' }, { season_id: 's1', kickoff_at: '2026-07-03T15:00:00Z' }), 88);
  assert.equal(recoveredFitness({ fitness: 98, season_id: 's1', last_played_at: '2026-07-01T15:00:00Z' }, { season_id: 's1', kickoff_at: '2026-07-03T15:00:00Z' }), 100);
});

test('season rollover resets fatigue and disciplinary carry-over', () => {
  const state = hydrateMatchState({
    rows: [{ player_id: 'p1', season_id: 'old', fitness: 42, injury_status: 'injured', suspended: true, yellow_cards: 4, red_cards: 1 }],
    playerIds: ['p1'],
    fixture: { season_id: 'new', kickoff_at: '2026-08-01T15:00:00Z' }
  });
  assert.equal(state.players.p1.fitness, 100);
  assert.equal(state.players.p1.injury_status, null);
  assert.equal(state.players.p1.suspended, false);
  assert.equal(state.players.p1.yellow_cards, 0);
  assert.equal(state.players.p1.red_cards, 0);
});

test('application persists fitness, injury and discipline exactly once', () => {
  const result = {
    played_at: '2026-07-01T17:00:00Z',
    state_changes: {
      fitness: [{ player_id: 'p1', side: 'home', starting_fitness: 100, projected_post_match_fitness: 68 }],
      injuries: [{ player_id: 'p1', side: 'home', status: 'injury_assessment_required' }],
      discipline: [{ player_id: 'p1', yellow_cards: 2, red_cards: 0, sent_off: true, dismissal_type: 'second_yellow' }]
    }
  };
  const application = buildMatchStateApplication({ fixture: { id: 'f1', world_id: 'w1', season_id: 's1' }, result, runKey: 'w1:f1' });
  const first = applyApplicationInMemory({ rows: [], appliedRunKeys: new Set(), application });
  assert.equal(first.applied, true);
  assert.equal(first.rows[0].fitness, 68);
  assert.equal(first.rows[0].injury_status, 'injury_assessment_required');
  assert.equal(first.rows[0].yellow_cards, 2);
  assert.equal(first.rows[0].suspended, true);

  const replay = applyApplicationInMemory({ rows: first.rows, appliedRunKeys: first.appliedRunKeys, application });
  assert.equal(replay.applied, false);
  assert.deepEqual(replay.rows, first.rows);
});

test('two consecutive constitutional fixtures carry persisted fitness into Module C', () => {
  const firstContract = contract('fixture-1', '2026-07-01T15:00:00Z');
  const firstResult = simulateMatch(firstContract, world);
  const application = buildMatchStateApplication({ fixture: { id: 'fixture-1', world_id: 'world-1', season_id: 'season-1' }, result: firstResult, runKey: firstContract.run_key });
  const persisted = applyApplicationInMemory({ rows: [], appliedRunKeys: new Set(), application });

  const secondFixture = { season_id: 'season-1', kickoff_at: '2026-07-03T15:00:00Z' };
  const hydrated = hydrateMatchState({ rows: persisted.rows, playerIds: [...homeIds, ...awayIds], fixture: secondFixture });
  const secondContract = contract('fixture-2', secondFixture.kickoff_at, hydrated);
  const secondResult = simulateMatch(secondContract, world);

  const firstHome = firstResult.state_changes.fitness.find((row) => row.player_id === 'home-1');
  const secondHome = secondResult.state_changes.fitness.find((row) => row.player_id === 'home-1');
  assert.ok(firstHome.projected_post_match_fitness < 100);
  assert.ok(hydrated.players['home-1'].fitness > firstHome.projected_post_match_fitness);
  assert.ok(hydrated.players['home-1'].fitness < 100);
  assert.ok(Math.abs(secondHome.starting_fitness - hydrated.players['home-1'].fitness) < 0.011);
});
