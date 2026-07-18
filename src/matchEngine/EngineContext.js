const text = (value) => String(value ?? '').trim();

export const ENGINE_CONTEXT_VERSION = 'tbg-engine-context-v0.1';

function validateContract(contract) {
  if (!contract?.fixture || !contract?.teams?.home || !contract?.teams?.away) {
    throw new Error('A complete engine contract is required');
  }
}

/**
 * Shared mutable working state for a single deterministic match run.
 *
 * The input contract and world remain available unchanged while modules place
 * intermediate calculations in `state`. Nothing in this context is included
 * in the public result contract unless the orchestrator deliberately maps it.
 */
export class EngineContext {
  constructor({ contract, world }) {
    validateContract(contract);

    this.version = ENGINE_CONTEXT_VERSION;
    this.contract = contract;
    this.world = world || {};
    this.runKey = text(contract.run_key);
    this.fixture = contract.fixture;
    this.teams = contract.teams;
    this.playersById = new Map(
      (this.world.players || []).map((player) => [text(player.tbg_player_id), player])
    );
    this.state = Object.create(null);
  }

  getPlayer(playerId) {
    return this.playersById.get(text(playerId));
  }

  set(key, value) {
    this.state[key] = value;
    return value;
  }

  get(key) {
    return this.state[key];
  }
}

export function createEngineContext({ contract, world }) {
  return new EngineContext({ contract, world });
}
