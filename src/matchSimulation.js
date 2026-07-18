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

function effectiveWorld(contract, world = {}) {
  if (!contract?.match_state) return world;
  return {
    ...world,
    match_state: {
      ...(world.match_state || {}),
      ...contract.match_state,
      players: {
        ...(world.match_state?.players || {}),
        ...(contract.match_state.players || {})
      }
    }
  };
}

/**
 * Public match entry point.
 *
 * Both modes execute the complete A–F constitutional module chain. The default
 * remains the established compatibility result while calibration is reviewed;
 * callers may opt into `constitutional-v1` without changing the 2d5-v1 public
 * envelope. Persisted match-layer state may travel with the contract so local
 * and remote runners resolve the same recovered Fitness and context.
 */
export function simulateMatch(contract, world) {
  return runEnginePipeline({
    contract,
    world: effectiveWorld(contract, world),
    modules: CONSTITUTIONAL_ENGINE_MODULES,
    compatibilityRunner: resultRunner(contract)
  });
}
