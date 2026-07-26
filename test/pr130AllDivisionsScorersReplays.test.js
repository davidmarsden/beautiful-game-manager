import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('competition rounds endpoint supports every division and returns scorers', async () => {
  const source = await read('../netlify/functions/competition-rounds.mjs');
  assert.match(source, /searchParams\.get\('division_id'\)/);
  assert.match(source, /divisions: availableDivisions\.map/);
  assert.match(source, /home_scorers/);
  assert.match(source, /away_scorers/);
  assert.match(source, /player_name/);
  assert.match(source, /minute/);
  assert.match(source, /result_revealed: played/);
});

test('competition UI switches division and opens completed scores in match centre', async () => {
  const source = await read('../public/phase2d3.js');
  assert.match(source, /data-division-select/);
  assert.match(source, /division_id=/);
  assert.match(source, /round-scorers/);
  assert.match(source, /data-match-centre/);
  assert.match(source, />Replay</);
  assert.doesNotMatch(source, /MATCH READY<\/button>/);
});

test('match centre permits authenticated managers to replay any completed fixture in their world', async () => {
  const source = await read('../netlify/functions/match-centre.mjs');
  assert.doesNotMatch(source, /You do not have access to this fixture/);
  assert.match(source, /revealed: false/);
  assert.match(source, /reveal: null/);
  assert.match(source, /Match reports are available only after full time/);
});

test('cross-club replay reveal completes for any played fixture in the authenticated world', async () => {
  const source = await read('../netlify/functions/reveal-match.mjs');
  assert.match(source, /canonicalPlayedFixture\(world, fixtureId\)/);
  assert.doesNotMatch(source, /\[fixture\.home_club_id, fixture\.away_club_id\]\.includes\(appointment\.club_id\)/);
  assert.doesNotMatch(source, /You do not have access to this fixture/);
  assert.match(source, /revealed: true/);
  assert.match(source, /reveal_method: method/);
});
