export const ENGINE_MODULE_INTERFACE_VERSION = 'tbg-engine-module-v0.1';

const text = (value) => String(value ?? '').trim();

/**
 * Creates a versioned match-engine module descriptor.
 *
 * Modules receive the shared EngineContext and may write only to its internal
 * working state. The public match result remains the orchestrator's concern.
 */
export function createEngineModule({ id, name, order, constitution, execute }) {
  const moduleId = text(id);
  const moduleName = text(name);
  const moduleOrder = Number(order);

  if (!moduleId) throw new Error('Engine module id is required');
  if (!moduleName) throw new Error(`Engine module name is required: ${moduleId || 'unknown'}`);
  if (!Number.isInteger(moduleOrder) || moduleOrder < 1) {
    throw new Error(`Engine module order must be a positive integer: ${moduleId}`);
  }
  if (typeof execute !== 'function') throw new Error(`Engine module execute function is required: ${moduleId}`);

  return Object.freeze({
    interfaceVersion: ENGINE_MODULE_INTERFACE_VERSION,
    id: moduleId,
    name: moduleName,
    order: moduleOrder,
    constitution: text(constitution) || null,
    execute
  });
}

export function validateEngineModules(modules) {
  if (!Array.isArray(modules) || modules.length === 0) {
    throw new Error('At least one engine module is required');
  }

  const ids = new Set();
  const orders = new Set();

  for (const module of modules) {
    if (module?.interfaceVersion !== ENGINE_MODULE_INTERFACE_VERSION) {
      throw new Error(`Unsupported engine module interface: ${module?.id || 'unknown'}`);
    }
    if (ids.has(module.id)) throw new Error(`Duplicate engine module id: ${module.id}`);
    if (orders.has(module.order)) throw new Error(`Duplicate engine module order: ${module.order}`);
    if (typeof module.execute !== 'function') throw new Error(`Invalid engine module execute function: ${module.id}`);
    ids.add(module.id);
    orders.add(module.order);
  }

  return [...modules].sort((a, b) => a.order - b.order);
}
