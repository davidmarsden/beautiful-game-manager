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
  assert.equal(archive.players.every((row) => row.appearances >= row.starts), true);
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

test('counts substitute players used as appearances', () => {
  const season = completedSeason();
  const target = season.results.find((row) => ['home', 'away'].some((side) => {
    const starters = new Set(row.teams[side].starting_xi);
    return (row.lineup_state?.[side]?.players_used || []).some((id) => !starters.has(id));
  }));
  assert.ok(target);
  const side = ['home', 'away'].find((value) => {
    const starters = new Set(target.teams[value].starting_xi);
    return (target.lineup_state[value].players_used || []).some((id) => !starters.has(id));
  });
  const starters = new Set(target.teams[side].starting_xi);
  const substitute = target.lineup_state[side].players_used.find((id) => !starters.has(id));
  const archive = createSeasonArchive(season);
  assert.ok(archive.players.find((row) => row.player_id === substitute).appearances > 0);
});

test('preserves public events from the season harness for player awards', () => {
  const season = completedSeason();
  assert.ok(season.results.some((row) => row.events.length > 0));
  const archive = createSeasonArchive(season);
  const attributedGoals = archive.players.reduce((sum, row) => sum + row.goals, 0);
  assert.ok(attributedGoals >= 0);
  assert.ok(archive.awards.golden_boot.player_id);
});

test('suppresses player awards when the winning total is zero', () => {
  const season = completedSeason();
  const withoutAttributedEvents = {
    ...season,
    results: season.results.map((row) => ({ ...row, events: [] }))
  };
  const archive = createSeasonArchive(withoutAttributedEvents);

  assert.equal(archive.awards.golden_boot, null);
  assert.equal(archive.awards.assist_leader, null);
  assert.ok(archive.awards.appearance_leader);
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
        ...(row.events || []),
        { event_id: 'goal-regression', type: 'goal', player_id: scorer, assist_player_id: assister },
        { event_id: 'yellow-regression', type: 'yellow_card', player_id: booked }
      ]
    } : row)
  };

  const archive = createSeasonArchive(enriched);
  assert.ok(archive.players.find((row) => row.player_id === scorer).goals >= 1);
  assert.ok(archive.players.find((row) => row.player_id === assister).assists >= 1);
  assert.ok(archive.players.find((row) => row.player_id === booked).yellow_cards >= 1);
});

test('history index rejects duplicate season archives', () => {
  const archive = createSeasonArchive(completedSeason());
  const history = appendSeasonArchive(null, archive);
  assert.equal(history.archives.length, 1);
  assert.throws(() => appendSeasonArchive(history, archive), /already archived/);
});

test('archive rejects internally unreconciled standings', () => {
  const season = completedSeason();
  const broken = {
    ...season,
    standings: season.standings.map((row, index) => index === 0 ? { ...row, points: row.points + 1 } : row)
  };
  const archive = createSeasonArchive(broken);
  assert.equal(archive.accepted, false);
  assert.equal(archive.checks.standings_reconcile, false);
});

test('archive rejects standings that disagree with linked fixture scores', () => {
  const season = completedSeason();
  const broken = {
    ...season,
    results: season.results.map((row, index) => index === 0 ? {
      ...row,
      score: { home: row.score.home + 1, away: row.score.away }
    } : row)
  };
  const archive = createSeasonArchive(broken);
  assert.equal(archive.accepted, false);
  assert.equal(archive.checks.standings_match_fixture_scores, false);
});
