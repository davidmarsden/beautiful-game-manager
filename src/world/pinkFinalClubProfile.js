const DEFAULT_PINK_FINAL_CLUB_BASE_URL = 'https://davidmarsden.github.io/beautiful-game-data/clubs/';

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

function explicitPinkFinalClubUrl(club = {}) {
  return text(club.pink_final_club_profile_url || club.public_club_profile_url);
}

export function pinkFinalClubRouteKey(club = {}) {
  return text(
    club.pink_final_club_route_key
    || club.public_club_route_key
    || club.canonical_club_key
    || club.tbg_club_id
    || club.club_id
    || club.id
  ) || null;
}

export function pinkFinalClubPublicationState(club = {}) {
  const signals = [
    club.club_profile_published,
    club.pink_final_club_profile_published,
    club.public_club_profile_published,
    club.club_publication_status,
    club.club_profile_status
  ];

  // Explicit suppression wins even when an old public URL remains on the club.
  if (signals.some(falsey)) return 'unpublished';
  if (explicitPinkFinalClubUrl(club)) return 'published';
  if (signals.some(truthy)) return 'published';

  // Canonical club identity predates publication flags. The immutable club ID is
  // the public lookup key; labels, divisions and manager appointments never are.
  return pinkFinalClubRouteKey(club) ? 'published' : 'unpublished';
}

export function pinkFinalClubProfileUrl(club = {}, { baseUrl = DEFAULT_PINK_FINAL_CLUB_BASE_URL } = {}) {
  if (pinkFinalClubPublicationState(club) !== 'published') return null;

  const configuredBase = absoluteUrl(baseUrl, DEFAULT_PINK_FINAL_CLUB_BASE_URL) || DEFAULT_PINK_FINAL_CLUB_BASE_URL;
  const explicitUrl = absoluteUrl(explicitPinkFinalClubUrl(club), configuredBase);
  if (explicitUrl) return explicitUrl;

  const routeKey = pinkFinalClubRouteKey(club);
  if (!routeKey) return null;

  const url = new URL(configuredBase);
  url.searchParams.set('id', routeKey);
  return url.toString();
}

export function projectPinkFinalClubIdentity(club = {}, options = {}) {
  const profileUrl = pinkFinalClubProfileUrl(club, options);
  return {
    pink_final_club_route_key: pinkFinalClubRouteKey(club),
    pink_final_club_profile_status: profileUrl ? 'published' : 'unpublished',
    pink_final_club_profile_url: profileUrl
  };
}

export { DEFAULT_PINK_FINAL_CLUB_BASE_URL };
