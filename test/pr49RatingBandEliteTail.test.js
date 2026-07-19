import test from 'node:test';
import assert from 'node:assert/strict';
import { calibrateRatingBandQuality, RATING_BAND_DIALS } from '../src/matchEngine/modules/RatingBandCalibration.js';
import {
  runRatingBandValidation,
  runRatingBandInvestigation,
  TBG_RATING_BANDS
} from '../src/matchEngine/ratingBandValidation.js';

function quality(home, away) {
  const side = (teamStrength) => ({
    team_strength: teamStrength,
    units: {
      goalkeeping: { effective_quality: teamStrength },
      defence: { effective_quality: teamStrength },
      midfield: { effective_quality: teamStrength },
      attack: { effective_quality: teamStrength }
    }
  });
  return { version: 'test-quality', home: side(home), away: side(away) };
}

test('rating-band calibration leaves equal teams equal', () => {
  const result = calibrateRatingBandQuality(quality(90, 90));
  assert.equal(result.home.rating_band_multiplier, 1);
  assert.equal(result.away.rating_band_multiplier, 1);
  assert.equal(result.home.team_strength, 90);
  assert.equal(result.away.team_strength, 90);
});

test('rating-band calibration is symmetric and bounded', () => {
  const result = calibrateRatingBandQuality(quality(100, 1));
  assert.equal(result.home.rating_band_multiplier, RATING_BAND_DIALS.maximum_side_multiplier);
  assert.equal(result.away.rating_band_multiplier, RATING_BAND_DIALS.minimum_side_multiplier);
  assert.equal(result.rating_band_calibration.home_multiplier, RATING_BAND_DIALS.maximum_side_multiplier);
  assert.equal(result.rating_band_calibration.away_multiplier, RATING_BAND_DIALS.minimum_side_multiplier);
});

test('agreed TBG senior and youth rating bands remain explicit', () => {
  assert.deepEqual(
    Object.fromEntries(Object.entries(TBG_RATING_BANDS).map(([key, row]) => [key, row.rating])),
    {
      d1_elite: 95,
      d1_standard: 91,
      d2_standard: 89,
      lower_division_floor: 85,
      youth_19_21: 76,
      youth_15_18: 68
    }
  );
});

test('constitutional engine produces accepted rating-band and elite-tail gradients', () => {
  const report = runRatingBandValidation({ matchesPerPair: 120 });
  assert.equal(report.total_matches, 600);
  assert.equal(report.common_random_numbers, true);
  assert.equal(report.accepted, true, JSON.stringify({ checks: report.checks, scenarios: report.scenarios }, null, 2));
  assert.equal(Object.values(report.checks).every(Boolean), true);
});

test('rating-band fixtures expose their actual synthetic players and average gaps', () => {
  const report = runRatingBandInvestigation({ matchesPerPair: 80 });
  const [standard, floor] = report.scenarios;

  assert.equal(standard.stronger_fixture.player_count, 11);
  assert.equal(standard.weaker_fixture.player_count, 11);
  assert.equal(standard.stronger_fixture.players[0].position, 'Goalkeeper');
  assert.equal(standard.stronger_fixture.players[10].position, 'Left Winger');
  assert.equal(standard.stronger_fixture.players.every((player) => player.rating === 95), true);
  assert.equal(standard.weaker_fixture.players.every((player) => player.rating === 91), true);
  assert.equal(floor.weaker_fixture.players.every((player) => player.rating === 85), true);
  assert.equal(standard.expected_average_rating_gap, 4);
  assert.equal(floor.expected_average_rating_gap, 10);
  assert.equal(report.comparison.expected_gap_difference, 6);
});

test('rating-band diagnostics reconcile full W/D/L and goal totals', () => {
  const report = runRatingBandInvestigation({ matchesPerPair: 80 });
  for (const scenario of report.scenarios) {
    const { wins, draws, losses } = scenario.outcome_counts;
    assert.equal(wins + draws + losses, scenario.sample_size);
    assert.equal(scenario.stronger_goals - scenario.weaker_goals, scenario.total_goal_difference);
    assert.equal(
      scenario.stronger_side_splits.home.matches + scenario.stronger_side_splits.away.matches,
      scenario.sample_size
    );
    assert.equal(scenario.stronger_side_splits.home.matches, scenario.sample_size / 2);
    assert.equal(scenario.stronger_side_splits.away.matches, scenario.sample_size / 2);
  }
});
