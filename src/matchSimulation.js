import { runEnginePipeline } from './matchEngine/EngineOrchestrator.js';
import { CONSTITUTIONAL_ENGINE_MODULES } from './matchEngine/modules/index.js';
import { runBootstrapCompatibility } from './matchEngine/bootstrapCompatibility.js';

/**
 * Public compatibility entry point used by the fixture runner and existing tests.
 *
 * The match now passes through the ordered A–F constitutional module chain before
 * the unchanged bootstrap runner produces the existing 2d5-v1 result contract.
 */
export function simulateMatch(contract, world) {
  return runEnginePipeline({
    contract,
    world,
    modules: CONSTITUTIONAL_ENGINE_MODULES,
    compatibilityRunner: runBootstrapCompatibility
  });
}
