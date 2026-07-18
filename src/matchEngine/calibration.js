const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const round = (value, places = 4) => Number(Number(value).toFixed(places));
const average = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

export const CALIBRATION_PROFILE_VERSION = 'tbg-calibration-pr39-v0.1';

export const CALIBRATION_TARGETS = Object.freeze({
  average_total_goals: Object.freeze({ minimum: 1.6, maximum: 3.6 }),
  draw_rate: Object.freeze({ minimum: 0.12, maximum: 0.42 }),
  home_win_rate: Object.freeze({ minimum: 0.34, maximum: 0.62 }),
  stronger_team_non_loss_rate: Object.freeze({ minimum: 0.55, maximum: 0.92 }),
  high_score_rate: Object.freeze({ minimum: 0, maximum: 0.14 }),
  zero_zero_rate: Object.freeze({ minimum: 0.02, maximum: 0.24 })
});

function within(value, target) {
  return value >= target.minimum && value <= target.maximum;
}

export function calibrationMetrics(rows) {
  if (!Array.isArray(rows) || rows.length < 20) throw new Error('Calibration requires at least 20 match rows');
  const totalGoals = rows.map((row) => number(row.score?.home) + number(row.score?.away));
  const decisive = rows.filter((row) => row.stronger_side === 'home' || row.stronger_side === 'away');
  const strongerNonLosses = decisive.filter((row) => {
    if (row.stronger_side === 'home') return number(row.score?.home) >= number(row.score?.away);
    return number(row.score?.away) >= number(row.score?.home);
  });

  const metrics = {
    sample_size: rows.length,
    average_total_goals: round(average(totalGoals), 4),
    draw_rate: round(rows.filter((row) => number(row.score?.home) === number(row.score?.away)).length / rows.length, 4),
    home_win_rate: round(rows.filter((row) => number(row.score?.home) > number(row.score?.away)).length / rows.length, 4),
    stronger_team_non_loss_rate: round(decisive.length ? strongerNonLosses.length / decisive.length : 0, 4),
    high_score_rate: round(totalGoals.filter((goals) => goals >= 6).length / rows.length, 4),
    zero_zero_rate: round(totalGoals.filter((goals) => goals === 0).length / rows.length, 4)
  };

  const checks = Object.fromEntries(Object.entries(CALIBRATION_TARGETS).map(([key, target]) => [key, within(metrics[key], target)]));
  return Object.freeze({
    version: CALIBRATION_PROFILE_VERSION,
    metrics: Object.freeze(metrics),
    targets: CALIBRATION_TARGETS,
    checks: Object.freeze(checks),
    accepted: Object.values(checks).every(Boolean)
  });
}
