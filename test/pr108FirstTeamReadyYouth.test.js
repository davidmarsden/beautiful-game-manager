import test from 'node:test';
import assert from 'node:assert/strict';
import { analyseSquad, countsForFirstTeamViability, FIRST_TEAM_READY_YOUTH_RATING } from '../src/intelligence/squadIntelligence.js';
import { createPersistentLeagueWorld } from '../src/world/persistentLeagueWorld.js';
import { planCanonicalRegistrationRepair, selectViableRegistrationIds } from '../src/world/viableCanonicalRegistration.js';

function player(id, position, age, rating) {
  return { tbg_player_id: id, display_name: id, position, age, underlying_ability_rating: rating, club_id: 'club-a', contract_id: null };
}

function squad(youthRating) {
  const players = [
    player('gk-adult', 'GK', 25, 72),
    player('gk-youth', 'GK', 18, youthRating),
    ...Array.from({ length: 6 }, (_, index) => player(`def-${index + 1}`, 'CB', 24, 78 - index)),
    ...Array.from({ length: 5 }, (_, index) => player(`mid-${index + 1}`, 'CM', 24, 77 - index)),
    ...Array.from({ length: 5 }, (_, index) => player(`att-${index + 1}`, 'CF', 24, 76 - index))
  ];
  const ids = players.map((row) => row.tbg_player_id);
  return {
    players,
    state: {
      season_id: 'season-1',
      calendar: { season_start: '2026-08-01T00:00:00.000Z', season_end: '2027-06-30T23:59:59.000Z' },
      clubs: { 'club-a': { club_id: 'club-a', player_ids: ids, registered_player_ids: ids } },
      players: Object.fromEntries(players.map((row) => [row.tbg_player_id, row])),
      contracts: {}
    }
  };
}

function persistentClub(id, includeYouth = false) {
  const players = [
    ...Array.from({ length: 2 }, (_, index) => ({ ...player(`${id}-gk-${index + 1}`, 'GK', 24, 75 - index), club_id: id, registered: true })),
    ...Array.from({ length: 6 }, (_, index) => ({ ...player(`${id}-def-${index + 1}`, 'CB', 24, 78 - index), club_id: id, registered: true })),
    ...Array.from({ length: 5 }, (_, index) => ({ ...player(`${id}-mid-${index + 1}`, 'CM', 24, 77 - index), club_id: id, registered: true })),
    ...Array.from({ length: 5 }, (_, index) => ({ ...player(`${id}-att-${index + 1}`, 'CF', 24, 76 - index), club_id: id, registered: true }))
  ];
  if (includeYouth) {
    players[players.length - 1] = { ...player(`${id}-youth`, 'CF', 18, 82), club_id: id, registered: true };
  }
  return { club_id: id, club_name: id, formation: '4-3-3-wide', players };
}

function persistentWorldWithYouth() {
  const divisions = [1, 2].map((level) => ({
    division_id: `d${level}`,
    level,
    clubs: Array.from({ length: 4 }, (_, index) => persistentClub(`d${level}-club-${index + 1}`, level === 1 && index === 0))
  }));
  return createPersistentLeagueWorld({
    worldId: 'custom-threshold-preview-test',
    divisions,
    humanClubId: 'd1-club-1',
    seasonStart: '2026-08-01T00:00:00.000Z',
    seasonEnd: '2027-06-30T23:59:59.000Z',
    movementCount: 1
  });
}

test('first-team readiness applies the governed 80-rating youth boundary', () => {
  assert.equal(FIRST_TEAM_READY_YOUTH_RATING, 80);
  assert.equal(countsForFirstTeamViability(player('ready', 'GK', 18, 80)), true);
  assert.equal(countsForFirstTeamViability(player('not-ready', 'GK', 18, 79)), false);
  assert.equal(countsForFirstTeamViability(player('adult', 'GK', 19, 40)), true);
});

test('an 80-rated registered youth counts for squad size and positional coverage', () => {
  const { state } = squad(80);
  const report = analyseSquad(state, { clubId: 'club-a' });
  const goalkeepers = report.coverage.find((row) => row.group === 'goalkeeper');
  assert.equal(report.summary.registered_first_team, 18);
  assert.equal(report.summary.registered_first_team_ready_youth, 1);
  assert.equal(report.summary.hard_minimum_gap, 0);
  assert.equal(goalkeepers.registered, 2);
  assert.equal(goalkeepers.registered_gap, 0);
  assert.equal(report.viable, true);
});

test('a 79-rated youth remains a prospect and does not pad first-team viability', () => {
  const { state } = squad(79);
  const report = analyseSquad(state, { clubId: 'club-a' });
  const goalkeepers = report.coverage.find((row) => row.group === 'goalkeeper');
  assert.equal(report.summary.registered_first_team, 17);
  assert.equal(report.summary.registered_first_team_ready_youth, 0);
  assert.equal(report.summary.hard_minimum_gap, 1);
  assert.equal(goalkeepers.registered, 1);
  assert.equal(goalkeepers.registered_gap, 1);
  assert.equal(report.viable, false);
});

test('position-first registration retains a ready youth but excludes a below-threshold youth', () => {
  const ready = squad(80).players;
  const notReady = squad(79).players;
  assert.ok(selectViableRegistrationIds(ready).selected_ids.includes('gk-youth'));
  assert.equal(selectViableRegistrationIds(notReady).selected_ids.includes('gk-youth'), false);
});

test('external free-agent selection prefers a higher-rated ready youth over an adult', () => {
  const readyYouth = player('ready-youth-gk', 'GK', 18, 90);
  const adult = player('adult-gk', 'GK', 27, 80);
  const selection = selectViableRegistrationIds([readyYouth, adult], 2, { goalkeeper: 1 });
  assert.deepEqual(selection.selected_ids, ['ready-youth-gk', 'adult-gk']);
});

test('preview action rows honour a configured youth readiness threshold', () => {
  const result = planCanonicalRegistrationRepair(persistentWorldWithYouth(), { youthRatingThreshold: 85 });
  const club = result.preview.clubs.find((row) => row.club_id === 'd1-club-1');
  const removedYouth = club.registrations_removed.find((row) => row.player_id === 'd1-club-1-youth');
  assert.ok(removedYouth);
  assert.equal(result.preview.first_team_ready_youth_rating, 85);
  assert.equal(removedYouth.first_team_ready_youth, false);
  assert.equal(club.first_team_ready_youth, 0);
});
