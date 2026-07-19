const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const round = (value, places = 4) => Number(Number(value).toFixed(places));

export const RATING_BAND_CALIBRATION_VERSION = 'tbg-rating-band-calibration-v1.0';
export const RATING_BAND_CALIBRATION_STATE_KEY = 'module_b_rating_band_calibration';

export const RATING_BAND_DIALS = Object.freeze({
  quality_gap_multiplier_per_point: 0.0125,
  maximum_side_multiplier: 1.12,
  minimum_side_multiplier: 0.88
});

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function calibratedSide(side, opponent, signedGap) {
  const multiplier = clamp(
    1 + signedGap * RATING_BAND_DIALS.quality_gap_multiplier_per_point,
    RATING_BAND_DIALS.minimum_side_multiplier,
    RATING_BAND_DIALS.maximum_side_multiplier
  );
  const units = Object.fromEntries(Object.entries(side.units || {}).map(([unit, row]) => [unit, {
    ...row,
    raw_effective_quality: number(row.effective_quality),
    effective_quality: round(clamp(number(row.effective_quality) * multiplier, 1, 100), 3)
  }]));
  return {
    ...side,
    raw_team_strength: number(side.team_strength),
    opponent_raw_team_strength: number(opponent.team_strength),
    rating_gap: round(signedGap, 3),
    rating_band_multiplier: round(multiplier, 4),
    units,
    team_strength: round(clamp(number(side.team_strength) * multiplier, 1, 100), 3)
  };
}

export function calibrateRatingBandQuality(quality) {
  if (!quality?.home || !quality?.away) throw new Error('Rating-band calibration requires Module B home and away quality');
  const rawGap = number(quality.home.team_strength) - number(quality.away.team_strength);
  const home = calibratedSide(quality.home, quality.away, rawGap);
  const away = calibratedSide(quality.away, quality.home, -rawGap);
  return deepFreeze({
    ...quality,
    version: `${quality.version}+${RATING_BAND_CALIBRATION_VERSION}`,
    home,
    away,
    rating_band_calibration: deepFreeze({
      version: RATING_BAND_CALIBRATION_VERSION,
      raw_quality_gap: round(rawGap, 3),
      home_multiplier: home.rating_band_multiplier,
      away_multiplier: away.rating_band_multiplier,
      bounded: true
    })
  });
}

export function executeRatingBandCalibration(context) {
  const calibrated = calibrateRatingBandQuality(context.get('module_b_player_quality'));
  context.set('module_b_player_quality', calibrated);
  context.set(RATING_BAND_CALIBRATION_STATE_KEY, calibrated.rating_band_calibration);
  return context;
}
