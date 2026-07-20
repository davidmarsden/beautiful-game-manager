import test from 'node:test';
import assert from 'node:assert/strict';
import { runFinalOutcomeCalibration } from '../src/matchEngine/finalOutcomeCalibration.js';

function indexFrom(contract) {
  return Number(String(contract.fixture.fixture_id).split('-').at(-1));
}

function result(contract, score) {
  return {
    fixture_id: contract.fixture.fixture_id,
    run_key: contract.run_key,
    score,
    outcome: score.home > score.away ? 'home_win' : score.away > score.home ? 'away_win' : 'draw',
    events: [], statistics: {}, lineup_state: {},
    state_changes: { fitness: [], injuries: [], discipline: [] }
  };
}

function calibratedSimulator(contract) {
  const index = indexFrom(contract);
  const gap = Number(contract.validation_gap || 0);
  const roll = index % 20;
  let score;
  if (gap === 0) score = roll < 8 ? { home: 2, away: 1 } : roll < 14 ? { home: 1, away: 1 } : { home: 1, away: 2 };
  else {
    const strongerHome = index % 2 === 0;
    const upsetCutoff = gap === 2 ? 6 : gap === 4 ? 5 : 3;
    const drawCutoff = upsetCutoff + 5;
    if (roll < upsetCutoff) score = strongerHome ? { home: 1, away: 2 } : { home: 2, away: 1 };
    else if (roll < drawCutoff) score = { home: 1, away: 1 };
    else score = strongerHome ? { home: 2, away: 1 } : { home: 1, away: 2 };
  }
  return result(contract, score);
}

function drawMaskedRegressionSimulator(contract) {
  const index = indexFrom(contract);
  const gap = Number(contract.validation_gap || 0);
  const roll = index % 10;
  if (gap === 0) {
    const score = roll < 4 ? { home: 2, away: 1 } : roll < 7 ? { home: 1, away: 1 } : { home: 1, away: 2 };
    return result(contract, score);
  }
  const strongerHome = index % 2 === 0;
  const score = roll === 0
    ? (strongerHome ? { home: 2, away: 1 } : { home: 1, away: 2 })
    : roll < 7
      ? { home: 1, away: 1 }
      : (strongerHome ? { home: 1, away: 2 } : { home: 2, away: 1 });
  return result(contract, score);
}

test('final calibration covers equal teams and the declared rating-gap ladder', () => {
  const report = runFinalOutcomeCalibration({ matchesPerScenario: 200, simulator: calibratedSimulator });
  assert.equal(report.accepted, true, JSON.stringify(report.checks, null, 2));
  assert.deepEqual(report.scenarios.map((row) => row.rating_gap), [0, 2, 4, 10]);
  assert.equal(report.total_matches, 800);
  assert.ok(report.scenarios.every((row) => row.average_goals_per_match >= 1.8));
  assert.equal(report.checks.stronger_sides_outwin_upsets_at_every_gap, true);
});

test('larger gaps reduce upset frequency without eliminating upsets', () => {
  const report = runFinalOutcomeCalibration({ matchesPerScenario: 200, simulator: calibratedSimulator });
  const ladder = report.rating_gap_ladder;
  assert.ok(ladder[0].upset_rate >= ladder[1].upset_rate);
  assert.ok(ladder[1].upset_rate >= ladder[2].upset_rate);
  assert.ok(ladder.every((row) => row.upset_rate > 0));
  assert.ok(ladder.every((row) => row.stronger_win_rate < 0.9));
  assert.ok(ladder.every((row) => row.stronger_win_rate > row.upset_rate));
});

test('draw-heavy samples cannot hide stronger sides losing more often than they win', () => {
  const report = runFinalOutcomeCalibration({ matchesPerScenario: 200, simulator: drawMaskedRegressionSimulator });
  assert.equal(report.accepted, false);
  assert.equal(report.checks.stronger_sides_outwin_upsets_at_every_gap, false);
  assert.equal(report.checks.gap_2_within_frequency_bands, false);
  assert.ok(report.rating_gap_ladder.every((row) => row.stronger_non_loss_rate >= 0.7));
  assert.ok(report.rating_gap_ladder.every((row) => row.stronger_win_rate < row.upset_rate));
});

test('calibration rejects too-small or odd samples', () => {
  assert.throws(() => runFinalOutcomeCalibration({ matchesPerScenario: 199, simulator: calibratedSimulator }), /even sample of at least 200/);
  assert.throws(() => runFinalOutcomeCalibration({ matchesPerScenario: 201, simulator: calibratedSimulator }), /even sample of at least 200/);
});

test('explicit thresholds can fail an otherwise stable report', () => {
  const report = runFinalOutcomeCalibration({
    matchesPerScenario: 200,
    simulator: calibratedSimulator,
    thresholds: {
      average_goals_per_match: { minimum: 4, maximum: 5 },
      equal_team_draw_rate: { minimum: 0, maximum: 1 },
      equal_team_home_win_rate: { minimum: 0, maximum: 1 },
      home_win_advantage: { minimum: -1, maximum: 1 },
      rating_gaps: {
        2: { stronger_win_minimum: 0, stronger_non_loss_minimum: 0, upset_minimum: 0, upset_maximum: 1 },
        4: { stronger_win_minimum: 0, stronger_non_loss_minimum: 0, upset_minimum: 0, upset_maximum: 1 },
        10: { stronger_win_minimum: 0, stronger_non_loss_minimum: 0, upset_minimum: 0, upset_maximum: 1 }
      },
      maximum_non_loss_regression_between_gaps: 1,
      maximum_upset_increase_between_gaps: 1
    }
  });
  assert.equal(report.accepted, false);
  assert.equal(report.checks.every_scenario_has_realistic_scoring, false);
});
