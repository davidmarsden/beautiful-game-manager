const FORBIDDEN_SCOPE_KEYS = new Set([
  'world', 'world_id', 'appointment', 'appointment_id', 'manager', 'manager_id',
  'season', 'season_id', 'squad', 'squad_id'
]);
const SAFE_CLUB_ID = /^[A-Za-z0-9._:-]{1,160}$/;

export function requestedTbgClubId(value = '') {
  let url;
  try {
    url = new URL(value, 'https://manager.invalid/');
  } catch {
    return null;
  }
  if ([...url.searchParams.keys()].some((key) => FORBIDDEN_SCOPE_KEYS.has(key.toLowerCase()))) return null;
  const clubId = String(url.searchParams.get('club') || '').trim();
  return SAFE_CLUB_ID.test(clubId) ? clubId : null;
}

export function tbgClubEntryUrl(club = {}, { baseUrl = 'https://beautiful-game-manager.netlify.app/' } = {}) {
  const clubId = String(club.tbg_club_id || club.club_id || club.id || '').trim();
  if (!SAFE_CLUB_ID.test(clubId)) return null;
  const url = new URL(baseUrl);
  url.search = '';
  url.hash = '';
  url.searchParams.set('club', clubId);
  return url.toString();
}
