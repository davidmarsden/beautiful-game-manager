import { runEnginePipeline } from './matchEngine/EngineOrchestrator.js';
import { CONSTITUTIONAL_ENGINE_MODULES } from './matchEngine/modules/index.js';
import { runBootstrapCompatibility } from './matchEngine/bootstrapCompatibility.js';
import { runConstitutionalPublicResult } from './matchEngine/constitutionalPublicResult.js';

export const MATCH_ENGINE_MODES = Object.freeze({
  compatibility: 'compatibility',
  constitutional: 'constitutional-v1'
});

function resultRunner(contract = {}) {
  const mode = String(contract.engine_mode || contract.match_engine_mode || '').trim().toLowerCase();
  return mode === MATCH_ENGINE_MODES.constitutional
    ? runConstitutionalPublicResult
    : runBootstrapCompatibility;
}

/**
 * Public match entry point.
 *
 * Both modes execute the complete A–F constitutional module chain. The default
 * remains the established compatibility result while calibration is reviewed;
 * callers may opt into `constitutional-v1` without changing the 2d5-v1 public
 * envelope. This gives fixture runners a reversible, explicit cutover path.
 */
export function simulateMatch(contract, world) {
  return runEnginePipeline({
    contract,
    world,
    modules: CONSTITUTIONAL_ENGINE_MODULES,
    compatibilityRunner: resultRunner(contract)
  });
}
