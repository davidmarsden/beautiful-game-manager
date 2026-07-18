const text = (value) => String(value ?? '').trim().toLowerCase();

export const TACTICAL_RESOLUTION_VERSION = 'tbg-tactical-resolution-v0.1';
export const TACTICAL_RESOLUTION_STATE_KEY = 'module_a_tactical_resolution';

const FORMATION_PROFILES = Object.freeze({
  '4-4-2': Object.freeze({
    defensive_base: 'back_four',
    midfield_base: 'flat_midfield',
    attacking_apex: 'two_striker',
    natural_route: 'wide',
    shape_weights: Object.freeze({ defence: 0.34, midfield: 0.32, attack: 0.34 }),
    gain: 'Two-striker presence and natural wide delivery.',
    exposure: 'Can concede central midfield control against an extra midfielder.'
  }),
  '4-3-3-wide': Object.freeze({
    defensive_base: 'back_four',
    midfield_base: 'single_pivot',
    attacking_apex: 'wide_forward',
    natural_route: 'wide',
    shape_weights: Object.freeze({ defence: 0.31, midfield: 0.34, attack: 0.35 }),
    gain: 'Wide-forward threat with three central midfield roles.',
    exposure: 'The single pivot can be isolated by central overloads.'
  }),
  '4-2-3-1': Object.freeze({
    defensive_base: 'back_four',
    midfield_base: 'double_pivot',
    attacking_apex: 'lone_striker',
    natural_route: 'balanced',
    shape_weights: Object.freeze({ defence: 0.33, midfield: 0.38, attack: 0.29 }),
    gain: 'Strong central control and protection behind the attacking midfield line.',
    exposure: 'The lone striker can become isolated when support is pinned back.'
  }),
  '4-1-4-1': Object.freeze({
    defensive_base: 'back_four',
    midfield_base: 'single_pivot',
    attacking_apex: 'lone_striker',
    natural_route: 'central',
    shape_weights: Object.freeze({ defence: 0.33, midfield: 0.40, attack: 0.27 }),
    gain: 'Five-player midfield occupation and patient territorial control.',
    exposure: 'Limited penalty-area presence without aggressive midfield support.'
  }),
  '3-5-2': Object.freeze({
    defensive_base: 'back_three',
    midfield_base: 'double_pivot',
    attacking_apex: 'two_striker',
    natural_route: 'wide',
    shape_weights: Object.freeze({ defence: 0.34, midfield: 0.36, attack: 0.30 }),
    gain: 'Central defensive mass, wing-back width and two-striker presence.',
    exposure: 'Space appears outside the back three when wing-backs are forced deep or caught high.'
  }),
  '3-4-3': Object.freeze({
    defensive_base: 'back_three',
    midfield_base: 'double_pivot',
    attacking_apex: 'wide_forward',
    natural_route: 'wide',
    shape_weights: Object.freeze({ defence: 0.32, midfield: 0.31, attack: 0.37 }),
    gain: 'A five-lane attacking line with wide overload potential.',
    exposure: 'The two-player central midfield can be outnumbered and played around.'
  }),
  '5-3-2': Object.freeze({
    defensive_base: 'back_five',
    midfield_base: 'single_pivot',
    attacking_apex: 'two_striker',
    natural_route: 'wide',
    shape_weights: Object.freeze({ defence: 0.41, midfield: 0.32, attack: 0.27 }),
    gain: 'Strong box protection with two outlets retained for transition.',
    exposure: 'Concedes territory and can struggle to sustain attacks.'
  })
});

const STYLE_PROFILES = Object.freeze({
  possession: Object.freeze({
    control: 0.10,
    chance_volume: 0.04,
    transition_threat: -0.04,
    defensive_risk: 0.05,
    gain: 'Patient control and repeat attacks.',
    exposure: 'Vulnerable to compact resistance and turnovers behind committed possession.'
  }),
  counter_transition: Object.freeze({
    control: -0.08,
    chance_volume: -0.02,
    transition_threat: 0.12,
    defensive_risk: 0.04,
    gain: 'High-value attacks immediately after turnovers.',
    exposure: 'Can be starved by an opponent that refuses to over-commit.'
  }),
  direct: Object.freeze({
    control: -0.10,
    chance_volume: 0.09,
    transition_threat: 0.05,
    defensive_risk: 0.03,
    gain: 'Early territory and a higher volume of direct attacks.',
    exposure: 'Lower average chance quality and dependence on winning first and second balls.'
  }),
  high_press: Object.freeze({
    control: 0.06,
    chance_volume: 0.08,
    transition_threat: 0.06,
    defensive_risk: 0.11,
    gain: 'Turnovers and territory close to the opposition goal.',
    exposure: 'Space behind the press when the first line is beaten.'
  }),
  low_block: Object.freeze({
    control: -0.12,
    chance_volume: -0.07,
    transition_threat: 0.07,
    defensive_risk: -0.09,
    gain: 'Compact space denial and protected central defensive zones.',
    exposure: 'Sustained territorial pressure, wide overloads and limited attacking volume.'
  }),
  balanced: Object.freeze({
    control: 0,
    chance_volume: 0,
    transition_threat: 0,
    defensive_risk: 0,
    gain: 'No strong stylistic commitment.',
    exposure: 'Cannot exploit a stylistic matchup as strongly as a committed plan.'
  })
});

const ROUTE_PROFILES = Object.freeze({
  central: Object.freeze({
    central_bias: 0.12,
    wide_bias: -0.08,
    matchup_upside: 0.08,
    robustness: -0.03,
    gain: 'Concentrates quality between and inside the opposition lines.',
    exposure: 'Runs into a packed centre and leaves less natural width.'
  }),
  balanced: Object.freeze({
    central_bias: 0,
    wide_bias: 0,
    matchup_upside: 0.02,
    robustness: 0.06,
    gain: 'Fewer severe spatial mismatches.',
    exposure: 'Robust rather than optimal; it rarely creates a decisive spatial edge.'
  }),
  wide: Object.freeze({
    central_bias: -0.06,
    wide_bias: 0.12,
    matchup_upside: 0.08,
    robustness: -0.03,
    gain: 'Stretches compact opponents and attacks the box from the flanks.',
    exposure: 'Can be contained by disciplined wide defenders and strong full-backs.'
  })
});

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function normaliseStyle(value) {
  const style = text(value).replaceAll('-', '_').replaceAll(' ', '_');
  if (style === 'counter' || style === 'transition' || style === 'counter_attacking') return 'counter_transition';
  if (style === 'pressing' || style === 'high_pressing') return 'high_press';
  if (style === 'deep_block') return 'low_block';
  return style;
}

function inferStyle(tactics = {}) {
  const explicit = normaliseStyle(tactics.style || tactics.tactical_style);
  if (explicit) return { style: explicit, source: 'manager_instruction' };

  const pressing = text(tactics.pressing);
  const mentality = text(tactics.mentality);
  const tempo = text(tactics.tempo);
  if (pressing === 'high') return { style: 'high_press', source: 'compatibility_inference' };
  if (pressing === 'low' && ['defensive', 'cautious'].includes(mentality)) return { style: 'low_block', source: 'compatibility_inference' };
  if (tempo === 'slow') return { style: 'possession', source: 'compatibility_inference' };
  if (tempo === 'fast' && ['positive', 'attacking'].includes(mentality)) return { style: 'counter_transition', source: 'compatibility_inference' };
  if (tempo === 'fast') return { style: 'direct', source: 'compatibility_inference' };
  return { style: 'balanced', source: 'compatibility_default' };
}

function inferRoute(tactics = {}) {
  const explicit = text(tactics.route_to_goal || tactics.route).replaceAll('-', '_').replaceAll(' ', '_');
  if (explicit) return { route: explicit, source: 'manager_instruction' };

  const width = text(tactics.width);
  if (width === 'narrow') return { route: 'central', source: 'compatibility_inference' };
  if (width === 'wide') return { route: 'wide', source: 'compatibility_inference' };
  return { route: 'balanced', source: width ? 'compatibility_inference' : 'compatibility_default' };
}

function routeFit(formation, route) {
  if (route === 'balanced') return 0;
  if (formation.natural_route === route) return 0.06;
  if (formation.natural_route === 'balanced') return 0.02;
  return -0.04;
}

export function resolveTeamTactics(team, side = team?.side) {
  const submittedFormation = text(team?.formation);
  const formationId = submittedFormation || '4-3-3-wide';
  const formation = FORMATION_PROFILES[formationId];
  if (!formation) throw new Error(`Unsupported Module A formation: ${formationId}`);

  const styleResolution = inferStyle(team?.tactics);
  const style = STYLE_PROFILES[styleResolution.style];
  if (!style) throw new Error(`Unsupported Module A tactical style: ${styleResolution.style}`);

  const routeResolution = inferRoute(team?.tactics);
  const route = ROUTE_PROFILES[routeResolution.route];
  if (!route) throw new Error(`Unsupported Module A route to goal: ${routeResolution.route}`);

  return deepFreeze({
    version: TACTICAL_RESOLUTION_VERSION,
    side: text(side),
    club_id: String(team?.club_id ?? '').trim() || null,
    formation: formationId,
    formation_source: submittedFormation ? 'manager_instruction' : 'compatibility_default',
    families: {
      defensive_base: formation.defensive_base,
      midfield_base: formation.midfield_base,
      attacking_apex: formation.attacking_apex
    },
    shape_weights: { ...formation.shape_weights },
    style: styleResolution.style,
    style_source: styleResolution.source,
    style_effects: {
      control: style.control,
      chance_volume: style.chance_volume,
      transition_threat: style.transition_threat,
      defensive_risk: style.defensive_risk
    },
    route_to_goal: routeResolution.route,
    route_source: routeResolution.source,
    route_effects: {
      central_bias: route.central_bias,
      wide_bias: route.wide_bias,
      matchup_upside: route.matchup_upside,
      robustness: route.robustness,
      formation_fit: routeFit(formation, routeResolution.route)
    },
    trade_offs: {
      formation: { gain: formation.gain, exposure: formation.exposure },
      style: { gain: style.gain, exposure: style.exposure },
      route: { gain: route.gain, exposure: route.exposure }
    }
  });
}

export function executeTacticalResolution(context) {
  const resolution = deepFreeze({
    version: TACTICAL_RESOLUTION_VERSION,
    home: resolveTeamTactics(context.teams.home, 'home'),
    away: resolveTeamTactics(context.teams.away, 'away')
  });
  context.set(TACTICAL_RESOLUTION_STATE_KEY, resolution);
  return context;
}

export const MODULE_A_FORMATIONS = Object.freeze(Object.keys(FORMATION_PROFILES));
export const MODULE_A_STYLES = Object.freeze(Object.keys(STYLE_PROFILES));
export const MODULE_A_ROUTES = Object.freeze(Object.keys(ROUTE_PROFILES));
