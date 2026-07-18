import { createEngineContext } from './EngineContext.js';
import { validateEngineModules } from './EngineModule.js';

export const ENGINE_ORCHESTRATOR_VERSION = 'tbg-engine-orchestrator-v0.1';

function validateCompatibilityRunner(compatibilityRunner) {
  if (typeof compatibilityRunner !== 'function') {
    throw new Error('Engine compatibility runner is required');
  }
}

/**
 * Executes the constitutional module chain in stable order, then delegates result
 * construction to the temporary bootstrap compatibility runner.
 *
 * Modules may mutate only EngineContext.state and must return the same context.
 * The compatibility runner is the sole producer of the public result contract
 * until the constitutional modules replace it in later milestones.
 */
export class EngineOrchestrator {
  constructor({ modules, compatibilityRunner }) {
    this.version = ENGINE_ORCHESTRATOR_VERSION;
    this.modules = Object.freeze(validateEngineModules(modules));
    validateCompatibilityRunner(compatibilityRunner);
    this.compatibilityRunner = compatibilityRunner;
  }

  run(context) {
    if (!context?.contract || !context?.fixture || !context?.teams) {
      throw new Error('A valid EngineContext is required');
    }

    const trace = [];
    for (const module of this.modules) {
      const returnedContext = module.execute(context);
      if (returnedContext !== context) {
        throw new Error(`Engine module must return the shared EngineContext: ${module.id}`);
      }
      trace.push(Object.freeze({ id: module.id, order: module.order }));
    }

    context.set('orchestration', Object.freeze({
      version: this.version,
      modules: Object.freeze(trace)
    }));

    const result = this.compatibilityRunner(context);
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      throw new Error('Engine compatibility runner must return a result object');
    }
    return result;
  }
}

export function createEngineOrchestrator(options) {
  return new EngineOrchestrator(options);
}

export function runEnginePipeline({ contract, world, modules, compatibilityRunner }) {
  const context = createEngineContext({ contract, world });
  const orchestrator = createEngineOrchestrator({ modules, compatibilityRunner });
  return orchestrator.run(context);
}
