import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('previous team history falls back to canonical match archives for newly appointed managers', async () => {
  const source = await read('netlify/functions/team-seed.mjs');

  assert.match(source, /canonical_match_archives/);
  assert.match(source, /function archivedTeamSheet\(row, clubId\)/);
  assert.match(source, /result\?\.teams\?\.\[side\]/);
  assert.match(source, /starting_xi: team\.starting_xi\.map\(String\)/);
  assert.match(source, /function mergeHistory\(turnHistory, archiveHistory, fixtureId\)/);
  assert.match(source, /source: 'canonical_match_archive'/);
  assert.match(source, /current \|\| history\[0\] \|\| null/);
});

test('auto-pick fills formation roles by compatible position before rating and falls back for unmatched outfield slots', async () => {
  const source = await read('public/formation-board.js');

  assert.match(source, /function roleCandidates\(role, pool\)/);
  assert.match(source, /allowed\.includes\(player\.position\)/);
  assert.match(source, /allowed\.indexOf\(left\.position\)/);
  assert.match(source, /function strongestFormationSelection\(\)/);
  assert.match(source, /slotOrder/);
  assert.match(source, /left\.choices - right\.choices/);
  assert.match(source, /const fallbackOrder = remaining\.sort/);
  assert.match(source, /if \(picked\[index\] \|\| role === 'GK'\) return/);
  assert.match(source, /const candidate = fallbackOrder\.shift\(\)/);
  assert.match(source, /const picked=strongestFormationSelection\(\)/);
  assert.doesNotMatch(source, /assignments=\[gk\?\.id\|\|null,\.\.\.rest\.slice\(0,10\)/);
});

test('captain options are only rebuilt when the selected XI actually changes', async () => {
  const source = await read('public/app.js');

  assert.match(source, /const optionsChanged = desired\.length !== current\.length/);
  assert.match(source, /if \(optionsChanged\) \{/);
  assert.match(source, /captain\.replaceChildren\(/);
  assert.match(source, /previousCaptainId && desired\.some/);
  assert.doesNotMatch(source, /captain\.innerHTML = selected\.map/);
});
