const DEFAULT_PINK_FINAL_BASE_URL = 'https://thepinkfinal.online/players/';

const text = (value) => String(value ?? '').trim();
const truthy = (value) => value === true || ['true', 'yes', 'published', 'public', 'live', 'eligible'].includes(text(value).toLowerCase());
const falsey = (value) => value === false || ['false', 'no', 'unpublished', 'private', 'hidden', 'ineligible', 'missing'].includes(text(value).toLowerCase());

function absoluteUrl(value, baseUrl) {
  const candidate = text(value);
  if (!candidate) return null;
  try {
    return new URL(candidate, baseUrl).toString();
  } catch {
    return null;
  }
}

function explicitPinkFinalUrl(player = {}) {
  // Generic profile_url belongs to imported provider data in the current world
  // (for example Transfermarkt). Only fields explicitly governed as Pink Final
  // public routes may override the canonical route-key URL.
  return text(player.pink_final_profile_url || player.public_profile_url);
}

function explicitPinkFinalRouteKey(player = {}) {
  return text(player.pink_final_route_key || player.profile_route_key || player.canonical_profile_key);
}

function generatedYouthPlayer(player = {}) {
  const id = text(player.tbg_player_id || player.player_id || player.id).toLowerCase();
  const source = text(player.source || player.player_source || player.origin || player.generated_source).toLowerCase();
  const type = text(player.player_type || player.registration_group || player.squad_status).toLowerCase();
  const hasYouthIntakeSeason = player.youth_intake_season !== undefined
    && player.youth_intake_season !== null
    && text(player.youth_intake_season) !== '';
  return Boolean(
    player.generated === true
    || player.is_generated === true
    || player.generated_youth === true
    || player.youth_intake_generated === true
    || hasYouthIntakeSeason
    || ['youth_intake', 'academy_intake', 'generated_youth', 'academy_generated'].includes(source)
    || ['generated_youth', 'academy_generated'].includes(type)
    || /(?:^|[-_:])(academy|youth)[-_:]?intake(?:[-_:]|$)/.test(id)
    || /(?:^|[-_:])youth[-_:][^-_:]+[-_:]\d+(?:[-_:]|$)/.test(id)
  );
}

export function pinkFinalPublicationState(player = {}) {
  const signals = [
    player.profile_published,
    player.pink_final_profile_published,
    player.public_profile_published,
    player.publication_status,
    player.profile_status
  ];

  // Explicit suppression always wins, including when stale public-profile URLs
  // remain on an imported or previously published player record.
  if (signals.some(falsey)) return 'unpublished';

  if (explicitPinkFinalUrl(player)) return 'published';
  if (signals.some(truthy)) return 'published';
  if (explicitPinkFinalRouteKey(player)) return 'published';

  // Generated academy players have durable in-world IDs but no Pink Final record
  // until the publication pipeline explicitly publishes them.
  if (generatedYouthPlayer(player)) return 'unpublished';

  // Existing canonical-world players pre-date the publication flag. Their durable
  // tbg_player_id is already the Pink Final lookup key, so preserve compatibility
  // without ever guessing from the display name.
  return text(player.tbg_player_id) ? 'published' : 'unpublished';
}

export function pinkFinalRouteKey(player = {}) {
  return text(
    player.pink_final_route_key
    || player.profile_route_key
    || player.canonical_profile_key
    || player.tbg_player_id
  ) || null;
}

export function pinkFinalProfileUrl(player = {}, { baseUrl = DEFAULT_PINK_FINAL_BASE_URL } = {}) {
  if (pinkFinalPublicationState(player) !== 'published') return null;

  const configuredBase = absoluteUrl(baseUrl, DEFAULT_PINK_FINAL_BASE_URL) || DEFAULT_PINK_FINAL_BASE_URL;
  const explicitUrl = absoluteUrl(explicitPinkFinalUrl(player), configuredBase);
  if (explicitUrl) return explicitUrl;

  const routeKey = pinkFinalRouteKey(player);
  if (!routeKey) return null;

  const url = new URL(configuredBase);
  url.searchParams.set('id', routeKey);
  return url.toString();
}

export function projectPinkFinalPlayerIdentity(player = {}, options = {}) {
  const sourceProfileUrl = text(player.source_profile_url || player.profile_url) || null;
  const profileUrl = pinkFinalProfileUrl(player, options);
  return {
    ...player,
    source_profile_url: sourceProfileUrl,
    pink_final_route_key: pinkFinalRouteKey(player),
    pink_final_profile_status: profileUrl ? 'published' : 'unpublished',
    profile_url: profileUrl
  };
}

export function projectPinkFinalSquadLinks(projection = {}, options = {}) {
  return {
    ...projection,
    squad: (projection.squad || []).map((player) => projectPinkFinalPlayerIdentity(player, options))
  };
}

export { DEFAULT_PINK_FINAL_BASE_URL };
