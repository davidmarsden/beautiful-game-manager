import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createSeasonArchive, createSeasonReportBundle, SEASON_ARCHIVE_VERSION } from '../src/history/seasonArchive.js';
import { projectPersistentHistory } from '../src/world/persistentHistoryProjection.js';

function sampleResult() {
  return {
    fixture: { fixture_id: 'f1', home_club_id: 'a', away_club_id: 'b', matchday: 1 },
    score: { home: 1, away: 0 },
    teams: { home: { starting_xi: Array.from({ length: 11 }, (_, i) => `a${i}`), bench: [] }, away: { starting_xi: Array.from({ length: 11 }, (_, i) => `b${i}`), bench: [] } },
    events: [{ type: 'goal', player_id: 'a0', commentary: "Queen's Park score" }]
  };
}

function sampleSeason() {
  return {
    season_id: 'w:season-1:d1',
    fixture_count: 1,
    standings: [
      { position: 1, club_id: 'a', played: 1, won: 1, drawn: 0, lost: 0, gf: 1, ga: 0, gd: 1, points: 3 },
      { position: 2, club_id: 'b', played: 1, won: 0, drawn: 0, lost: 1, gf: 0, ga: 1, gd: -1, points: 0 }
    ],
    results: [sampleResult()]
  };
}

test('history projection exposes every live division and persisted club continuity', () => {
  const world = {
    world_id: 'w',
    season_number: 11,
    club_profiles: { a: { club_name: "Queen's Park" }, b: { club_name: 'Beta' } },
    squad_cycle: { season_id: 'w:season-11', players: {} },
    competition: {
      divisions: [{ division_id: 'd1', level: 1, club_ids: ['a', 'b'] }],
      movement_history: [
        { movement_id: 'm9', season_id: 'w:season-9', club_id: 'a', from_division_id: 'd2', to_division_id: 'd1' },
        { movement_id: 'm10', season_id: 'w:season-10', club_id: 'a', from_division_id: 'd1', to_division_id: 'd2' }
      ]
    },
    matchday_cycle: { runtimes: { d1: { table: { a: { club_id: 'a', played: 1, won: 1, drawn: 0, lost: 0, gf: 2, ga: 0, gd: 2, points: 3 }, b: { club_id: 'b', played: 1, won: 0, drawn: 0, lost: 1, gf: 0, ga: 2, gd: -2, points: 0 } }, results: [], fixtures: [] } } },
    history: { archives: [{ archive_id: 'w:season-1:d1:archive', report_store_key: 'w:season-1:d1:reports', season_id: 'w:season-1:d1', summary: { champion_club_id: 'a' }, clubs: [{ position: 1, club_id: 'a', played: 1, won: 1, drawn: 0, lost: 0, goals_for: 2, goals_against: 0, goal_difference: 2, points: 3 }], awards: { champion: { club_id: 'a' } }, records: {}, source_fixture_ids: ['f1'] }] },
    completed_seasons: [{ season_id: 'w:season-1', movement_ids: [] }]
  };
  const bundle = { report_store_key: 'w:season-1:d1:reports', reports: [sampleResult()] };
  const history = projectPersistentHistory(world, { managedClubId: 'a', reportBundles: [bundle] });
  assert.equal(history.live_divisions[0].standings[0].club_name, "Queen's Park");
  assert.equal(history.seasons[0].divisions[0].results[0].fixture_id, 'f1');
  assert.equal(history.managed_club_history.movements[0].season_id, 'w:season-10');
  assert.equal(history.managed_club_history.movements[1].season_id, 'w:season-9');
});

test('canonical archive stays compact while report bundle retains drill-down data', () => {
  const season = sampleSeason();
  const archive = createSeasonArchive(season);
  const bundle = createSeasonReportBundle(season);
  assert.equal(SEASON_ARCHIVE_VERSION, 'tbg-season-archive-v1.3');
  assert.equal(Object.hasOwn(archive, 'results'), false);
  assert.equal(archive.report_store_key, bundle.report_store_key);
  assert.equal(bundle.reports[0].fixture.fixture_id, 'f1');
  assert.equal(bundle.reports[0].events[0].commentary, "Queen's Park score");
  assert.equal(archive.accepted, true);
});

test('portal safely references report indexes and loads the external report store', () => {
  const navigation = fs.readFileSync(new URL('../public/portal-navigation.js', import.meta.url), 'utf8');
  const historyUi = fs.readFileSync(new URL('../public/history.js', import.meta.url), 'utf8');
  const endpoint = fs.readFileSync(new URL('../netlify/functions/history.mjs', import.meta.url), 'utf8');
  const migration = fs.readFileSync(new URL('../supabase/migrations/20260726_pr120_external_season_report_store.sql', import.meta.url), 'utf8');
  assert.match(navigation, /import '\.\/history\.js'/);
  assert.match(navigation, /history\.css/);
  assert.match(navigation, /historyView/);
  assert.match(historyUi, /data-result-index/);
  assert.doesNotMatch(historyUi, /data-archive-result/);
  assert.match(endpoint, /season_match_report_bundles/);
  assert.match(migration, /persist_season_match_report_bundle/);
});
