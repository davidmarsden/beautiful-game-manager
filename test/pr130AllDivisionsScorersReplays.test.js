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
  assert.match(source, /canonical_match_archives\?fixture_id=eq\./);
  assert.match(source, /world_id=in\.\(/);
  assert.match(source, /manager_canonical_match_views\?manager_id=eq\./);
  assert.match(source, /revealed: Boolean\(reveal\?\.revealed_at\)/);
  assert.doesNotMatch(source, /\[fixture\.home_club_id, fixture\.away_club_id\]\.includes\(appointment\.club_id\)/);
  assert.doesNotMatch(source, /You do not have access to this fixture/);
});

test('cross-club replay reveal completes for any played fixture in the authenticated world', async () => {
  const source = await read('../netlify/functions/reveal-match.mjs');
  assert.match(source, /canonical_match_archives\?fixture_id=eq\./);
  assert.match(source, /world_id=in\.\(/);
  assert.match(source, /manager_canonical_match_views\?on_conflict=manager_id,fixture_id/);
  assert.doesNotMatch(source, /\[fixture\.home_club_id, fixture\.away_club_id\]\.includes\(appointment\.club_id\)/);
  assert.doesNotMatch(source, /You do not have access to this fixture/);
  assert.match(source, /revealed: true/);
  assert.match(source, /reveal_method: rows\[0\]\?\.reveal_method \|\| existing\?\.reveal_method \|\| method/);
});
