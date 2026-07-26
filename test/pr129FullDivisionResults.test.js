import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const roundsEndpoint = await readFile(new URL('../netlify/functions/competition-rounds.mjs', import.meta.url), 'utf8');
const competitionUi = await readFile(new URL('../public/phase2d3.js', import.meta.url), 'utf8');
const competitionCss = await readFile(new URL('../public/phase2d3.css', import.meta.url), 'utf8');

test('competition rounds endpoint projects every fixture in the appointed division', () => {
  assert.match(roundsEndpoint, /world\.matchday_cycle\?\.runtimes\?\.\[division\.division_id\]/);
  assert.match(roundsEndpoint, /runtime\.fixtures/);
  assert.match(roundsEndpoint, /runtime\.results/);
  assert.match(roundsEndpoint, /byMatchday/);
  assert.match(roundsEndpoint, /rounds:/);
});

test('competition rounds preserve spoiler protection for the managed club', () => {
  assert.match(roundsEndpoint, /managedFixture/);
  assert.match(roundsEndpoint, /played && !managedFixture/);
  assert.match(roundsEndpoint, /result_revealed: played && !managedFixture/);
});

test('competition page offers results and fixtures with previous and next round navigation', () => {
  assert.match(competitionUi, /data-round-mode=\"results\"/);
  assert.match(competitionUi, /data-round-mode=\"fixtures\"/);
  assert.match(competitionUi, /data-round-step=\"-1\"/);
  assert.match(competitionUi, /data-round-step=\"1\"/);
  assert.match(competitionUi, /Matchday \$\{escapeHtml\(selectedMatchday\)\}/);
});

test('full division rows retain shared club inspection and managed match-centre access', () => {
  assert.match(competitionUi, /clubLink\(fixture\.home_club_id, fixture\.home_club_name\)/);
  assert.match(competitionUi, /clubLink\(fixture\.away_club_id, fixture\.away_club_name\)/);
  assert.match(competitionUi, /data-match-centre=\"\$\{escapeHtml\(fixture\.fixture_id\)\}\"/);
  assert.match(competitionCss, /managed-fixture/);
});
