import test from 'node:test';
import assert from 'node:assert/strict';
import { simulateStatefulSeason, syntheticSeasonClubs } from '../src/matchEngine/seasonSimulation.js';
import { appendSeasonArchive, createSeasonArchive } from '../src/history/seasonArchive.js';

function completedSeason() {
  return simulateStatefulSeason({
    clubs: syntheticSeasonClubs({ clubCount: 4, baseRating: 86 }),
    seasonId: 'pr69-archive-season',
    startAt: '2026-08-01T15:00:00.000Z'
  });
}

test('archives a completed season with reconciled club and player records', () => {
  const season = completedSeason();
  const archive = createSeasonArchive(season, { archivedAt: '2027-07-01T00:00:00.000Z' });

  assert.equal(archive.accepted, true);
  assert.equal(archive.summary.club_count, 4);
  assert.equal(archive.summary.fixture_count, season.fixture_count);
  assert.equal(archive.clubs.length, 4);
  assert.equal(archive.players.reduce((sum, row) => sum + row.starts, 0), season.fixture_count * 22);
  assert.equal(archive.awards.champion.club_id, season.standings[0].club_id);
  assert.equal(archive.source_fixture_ids.length, season.fixture_count);
});

test('awards and records use deterministic stable tie-breakers', () => {
  const season = completedSeason();
  const first = createSeasonArchive(season);
  const second = createSeasonArchive(season);

  assert.deepEqual(first, second);
  assert.equal(first.awards.best_attack.club_id, first.records.most_goals.club_id);
  assert.equal(first.awards.best_defence.club_id, first.records.fewest_goals_conceded.club_id);
  assert.ok(first.awards.appearance_leader.player_id);
});

test('records supported goal assist and card events without inventing unsupported totals', () => {
  const season = completedSeason();
  const target = season.results[0];
  const scorer = target.teams.home.starting_xi[0];
  const assister = target.teams.home.starting_xi[1];
  const booked = target.teams.away.starting_xi[0];
  const enriched = {
    ...season,
    results: season.results.map((row, index) => index === 0 ? {
      ...row,
      events: [
        { event_id: 'goal-1', type: 'goal', player_id: scorer, assist_player_id: assister },
        { event_id: 'yellow-1', type: 'yellow_card', player_id: booked }
      ]
    } : row)
  };

  const archive = createSeasonArchive(enriched);
  assert.equal(archive.players.find((row) => row.player_id === scorer).goals, 1);
  assert.equal(archive.players.find((row) => row.player_id === assister).assists, 1);
  assert.equal(archive.players.find((row) => row.player_id === booked).yellow_cards, 1);
  assert.equal(archive.awards.golden_boot.player_id, scorer);
  assert.equal(archive.awards.assist_leader.player_id, assister);
});

test('history index rejects duplicate season archives', () => {
  const archive = createSeasonArchive(completedSeason());
  const history = appendSeasonArchive(null, archive);
  assert.equal(history.archives.length, 1);
  assert.throws(() => appendSeasonArchive(history, archive), /already archived/);
});

test('archive rejects unreconciled standings', () => {
  const season = completedSeason();
  const broken = {
    ...season,
    standings: season.standings.map((row, index) => index === 0 ? { ...row, points: row.points + 1 } : row)
  };
  const archive = createSeasonArchive(broken);
  assert.equal(archive.accepted, false);
  assert.equal(archive.checks.standings_reconcile, false);
});
