import test from 'node:test';
import assert from 'node:assert/strict';
import { simulateMatch, MATCH_ENGINE_MODES } from '../src/matchSimulation.js';
import { calibrationMetrics } from '../src/matchEngine/calibration.js';

const positions = [
  'Goalkeeper', 'Right-Back', 'Centre-Back', 'Centre-Back', 'Left-Back',
  'Defensive Midfield', 'Central Midfield', 'Central Midfield',
  'Right Winger', 'Centre-Forward', 'Left Winger'
];

function players(prefix, rating) {
  return positions.map((position, index) => ({
    tbg_player_id: `${prefix}-${index + 1}`,
    display_name: `${prefix.toUpperCase()} ${index + 1}`,
    position,
    underlying_ability_rating: rating
  }));
}

function team(side, prefix, clubId) {
  return {
    side,
    club_id: clubId,
    club_name: clubId,
    formation: '4-3-3-wide',
    starting_xi: positions.map((_, index) => `${prefix}-${index + 1}`),
    bench: [],
    tactics: {
      mentality: 'balanced',
      pressing: 'mid',
      tempo: 'normal',
      style: 'balanced',
      route_to_goal: 'balanced'
    }
  };
}

function scenario(index, strongerSide) {
  const homeStrong = strongerSide === 'home';
  const homePrefix = homeStrong ? 'strong-home' : 'weak-home';
  const awayPrefix = homeStrong ? 'weak-away' : 'strong-away';
  const world = {
    players: [
      ...players(homePrefix, homeStrong ? 92 : 86),
      ...players(awayPrefix, homeStrong ? 86 : 92)
    ]
  };
  const contract = {
    contract_version: '2d2-v1',
    run_key: `calibration:${index}:${strongerSide}`,
    engine_mode: MATCH_ENGINE_MODES.constitutional,
    fixture: {
      fixture_id: `calibration-${index}`,
      season_id: 'calibration-season',
      matchday: index + 1,
      kickoff_at: '2026-07-18T15:00:00.000Z'
    },
    teams: {
      home: team('home', homePrefix, homeStrong ? 'Strong Home' : 'Weak Home'),
      away: team('away', awayPrefix, homeStrong ? 'Weak Away' : 'Strong Away')
    }
  };
  return { contract, world, stronger_side: strongerSide };
}

test('PR39 baseline satisfies broad football calibration guard rails', () => {
  const rows = [];
  for (let index = 0; index < 160; index += 1) {
    const strongerSide = index % 2 === 0 ? 'home' : 'away';
    const { contract, world, stronger_side } = scenario(index, strongerSide);
    const result = simulateMatch(contract, world);
    rows.push({ score: result.score, stronger_side });
  }

  const report = calibrationMetrics(rows);
  assert.equal(report.accepted, true, JSON.stringify(report, null, 2));
});

test('calibration metrics reject undersized samples', () => {
  assert.throws(() => calibrationMetrics([]), /at least 20/);
});
