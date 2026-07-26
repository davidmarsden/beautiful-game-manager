import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createSeasonArchive, SEASON_ARCHIVE_VERSION } from '../src/history/seasonArchive.js';
import { projectPersistentHistory } from '../src/world/persistentHistoryProjection.js';

test('history projection exposes every live division and persisted club continuity', () => {
  const world = {
    world_id: 'w',
    season_number: 2,
    club_profiles: { a: { club_name: 'Alpha' }, b: { club_name: 'Beta' } },
    squad_cycle: { season_id: 'w:season-2', players: {} },
    competition: {
      divisions: [{ division_id: 'd1', level: 1, club_ids: ['a', 'b'] }],
      movement_history: [{ movement_id: 'm1', season_id: 'w:season-1', club_id: 'a', from_division_id: 'd2', to_division_id: 'd1' }]
    },
    matchday_cycle: {
      runtimes: {
        d1: {
          table: {
            a: { club_id: 'a', played: 1, won: 1, drawn: 0, lost: 0, gf: 2, ga: 0, gd: 2, points: 3 },
            b: { club_id: 'b', played: 1, won: 0, drawn: 0, lost: 1, gf: 0, ga: 2, gd: -2, points: 0 }
          },
          results: [],
          fixtures: []
        }
      }
    },
    history: {
      archives: [{
        archive_id: 'w:season-1:d1:archive',
        season_id: 'w:season-1:d1',
        summary: { champion_club_id: 'a' },
        clubs: [{ position: 1, club_id: 'a', played: 1, won: 1, drawn: 0, lost: 0, goals_for: 2, goals_against: 0, goal_difference: 2, points: 3 }],
        awards: { champion: { club_id: 'a' } },
        records: {},
        results: [],
        source_fixture_ids: []
      }]
    },
    completed_seasons: [{ season_id: 'w:season-1', movement_ids: ['m1'] }]
  };
  const history = projectPersistentHistory(world, { managedClubId: 'a' });
  assert.equal(history.live_divisions[0].standings[0].club_name, 'Alpha');
  assert.equal(history.seasons[0].divisions[0].summary.champion_club_name, 'Alpha');
  assert.equal(history.managed_club_history.movements[0].to_division_name, 'Division 1');
});

test('new archives retain immutable result snapshots for historical drill-down', () => {
  const result = {
    fixture: { fixture_id: 'f1', home_club_id: 'a', away_club_id: 'b', matchday: 1 },
    score: { home: 1, away: 0 },
    teams: { home: { starting_xi: Array.from({ length: 11 }, (_, i) => `a${i}`), bench: [] }, away: { starting_xi: Array.from({ length: 11 }, (_, i) => `b${i}`), bench: [] } },
    events: [{ type: 'goal', player_id: 'a0' }]
  };
  const archive = createSeasonArchive({
    season_id: 'w:season-1:d1',
    fixture_count: 1,
    standings: [
      { position: 1, club_id: 'a', played: 1, won: 1, drawn: 0, lost: 0, gf: 1, ga: 0, gd: 1, points: 3 },
      { position: 2, club_id: 'b', played: 1, won: 0, drawn: 0, lost: 1, gf: 0, ga: 1, gd: -1, points: 0 }
    ],
    results: [result]
  });
  assert.equal(SEASON_ARCHIVE_VERSION, 'tbg-season-archive-v1.3');
  assert.equal(archive.results[0].fixture.fixture_id, 'f1');
  assert.equal(archive.results[0].events[0].player_id, 'a0');
  assert.equal(archive.accepted, true);
});

test('portal loads persistent history assets and endpoint', () => {
  const navigation = fs.readFileSync(new URL('../public/portal-navigation.js', import.meta.url), 'utf8');
  assert.match(navigation, /import '\.\/history\.js'/);
  assert.match(navigation, /history\.css/);
  assert.match(navigation, /historyView/);
  assert.match(fs.readFileSync(new URL('../netlify/functions/history.mjs', import.meta.url), 'utf8'), /projectPersistentHistory/);
});
