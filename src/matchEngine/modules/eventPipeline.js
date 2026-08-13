import { createEngineModule, validateEngineModules } from '../EngineModule.js';
import { realiseCausalEventGeneration, reconcileCausalResolution, reconcileOwnGoalCommentary } from '../CausalEventRealisation.js';
import { reconcileOwnGoalRatings } from '../OwnGoalRatings.js';
import { executeTacticalResolution } from './TacticalResolution.js';
import { executePlayerQuality } from './PlayerQuality.js';
import { executeRatingBandCalibration, RATING_BAND_QUALITY_STATE_KEY } from './RatingBandCalibration.js';
import { executeFatigueContext } from './FatigueContext.js';
import { executeEventGeneration, EVENT_GENERATION_STATE_KEY } from './EventGeneration.js';
import { executeMatchResolution, MATCH_RESOLUTION_STATE_KEY } from './MatchResolution.js';
import { executeCommentaryReport, COMMENTARY_REPORT_STATE_KEY } from './CommentaryReport.js';
import { executePerformanceRatings, PERFORMANCE_RATINGS_STATE_KEY } from './PerformanceRatings.js';

const calibrationRequested = (contract = {}) => contract.rating_band_calibration === true || Number.isFinite(Number(contract.validation_gap)) || Boolean(contract.validation_scenario);

function qualityStage(context) {
  executePlayerQuality(context);
  if (calibrationRequested(context.contract)) executeRatingBandCalibration(context);
  return context;
}

function eventStage(context) {
  const rawQuality = context.get('module_b_player_quality');
  let eventQuality = rawQuality;
  if (calibrationRequested(context.contract)) {
    eventQuality = context.get(RATING_BAND_QUALITY_STATE_KEY);
    context.set('module_b_player_quality', eventQuality);
  }
  executeEventGeneration(context);
  if (eventQuality !== rawQuality) context.set('module_b_player_quality', rawQuality);
  context.set(EVENT_GENERATION_STATE_KEY, realiseCausalEventGeneration(context.get(EVENT_GENERATION_STATE_KEY), eventQuality));
  return context;
}

function resolutionStage(context) {
  executeMatchResolution(context);
  context.set(MATCH_RESOLUTION_STATE_KEY, reconcileCausalResolution(context.get(MATCH_RESOLUTION_STATE_KEY)));
  return context;
}

function reportStage(context) {
  executeCommentaryReport(context);
  context.set(COMMENTARY_REPORT_STATE_KEY, reconcileOwnGoalCommentary(context.get(COMMENTARY_REPORT_STATE_KEY), context.get(MATCH_RESOLUTION_STATE_KEY), context.get('module_b_player_quality')));
  return context;
}

function ratingsStage(context) {
  executePerformanceRatings(context);
  context.set(PERFORMANCE_RATINGS_STATE_KEY, reconcileOwnGoalRatings(context.get(PERFORMANCE_RATINGS_STATE_KEY), context.get(MATCH_RESOLUTION_STATE_KEY)));
  return context;
}

const A = createEngineModule({ id: 'module-a-tactical-resolution', name: 'Module A — Tactical Resolution', order: 1, constitution: 'Match Engine Constitution v0.3; Appendix A v0.3', execute: executeTacticalResolution });
const B = createEngineModule({ id: 'module-b-team-quality', name: 'Module B — Team Quality', order: 2, constitution: 'Match Engine Constitution v0.3; Player Rating Constitution v1.1', execute: qualityStage });
const C = createEngineModule({ id: 'module-c-fatigue-context', name: 'Module C — Fatigue & Context', order: 3, constitution: 'Match Engine Constitution v0.3; Appendix C v0.1', execute: executeFatigueContext });
const D = createEngineModule({ id: 'module-d-event-generation', name: 'Module D — Event Generation', order: 4, constitution: 'Match Engine Constitution v0.3; Appendix D v0.4', execute: eventStage });
const E = createEngineModule({ id: 'module-e-match-resolution', name: 'Module E — Match Resolution', order: 5, constitution: 'Match Engine Constitution v0.3', execute: resolutionStage });
const F = createEngineModule({ id: 'module-f-commentary-report', name: 'Module F — Commentary & Report', order: 6, constitution: 'Match Engine Constitution v0.3; Information, Media & Communication Constitution v1.2', execute: reportStage });
const G = createEngineModule({ id: 'module-g-performance-ratings', name: 'Module G — Player Performance Ratings', order: 7, constitution: 'Match Engine Constitution v0.3; Appendix E v0.1', execute: ratingsStage });

export const CONSTITUTIONAL_ENGINE_MODULES = Object.freeze(validateEngineModules([A, B, C, D, E, F, G]));
