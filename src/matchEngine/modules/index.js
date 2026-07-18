import { createEngineModule, validateEngineModules } from '../EngineModule.js';
import { executeTacticalResolution } from './TacticalResolution.js';
import { executePlayerQuality } from './PlayerQuality.js';
import { executeFatigueContext } from './FatigueContext.js';

const noOp = (context) => context;

export const MODULE_A_TACTICAL_RESOLUTION = createEngineModule({
  id: 'module-a-tactical-resolution',
  name: 'Module A — Tactical Resolution',
  order: 1,
  constitution: 'Match Engine Constitution v0.3; Appendix A v0.3',
  execute: executeTacticalResolution
});

export const MODULE_B_TEAM_QUALITY = createEngineModule({
  id: 'module-b-team-quality',
  name: 'Module B — Team Quality',
  order: 2,
  constitution: 'Match Engine Constitution v0.3; Player Rating Constitution v1.1',
  execute: executePlayerQuality
});

export const MODULE_C_FATIGUE_CONTEXT = createEngineModule({
  id: 'module-c-fatigue-context',
  name: 'Module C — Fatigue & Context',
  order: 3,
  constitution: 'Match Engine Constitution v0.3; Appendix C v0.1',
  execute: executeFatigueContext
});

export const MODULE_D_EVENT_GENERATION = createEngineModule({
  id: 'module-d-event-generation',
  name: 'Module D — Event Generation',
  order: 4,
  constitution: 'Match Engine Constitution v0.3; Appendix D',
  execute: noOp
});

export const MODULE_E_MATCH_RESOLUTION = createEngineModule({
  id: 'module-e-match-resolution',
  name: 'Module E — Match Resolution',
  order: 5,
  constitution: 'Match Engine Constitution v0.3',
  execute: noOp
});

export const MODULE_F_COMMENTARY_REPORT = createEngineModule({
  id: 'module-f-commentary-report',
  name: 'Module F — Commentary & Report',
  order: 6,
  constitution: 'Match Engine Constitution v0.3; Information, Media & Communication Constitution v1.2',
  execute: noOp
});

export const CONSTITUTIONAL_ENGINE_MODULES = Object.freeze(validateEngineModules([
  MODULE_A_TACTICAL_RESOLUTION,
  MODULE_B_TEAM_QUALITY,
  MODULE_C_FATIGUE_CONTEXT,
  MODULE_D_EVENT_GENERATION,
  MODULE_E_MATCH_RESOLUTION,
  MODULE_F_COMMENTARY_REPORT
]));