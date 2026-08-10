import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('previous-match team loader reads canonical turn submissions including consumed matches', () => {
  const source = fs.readFileSync(new URL('../netlify/functions/team-seed.mjs', import.meta.url), 'utf8');
  assert.match(source, /manager_turn_submissions/);
  assert.doesNotMatch(source, /\/rest\/v1\/manager_submissions/);
  assert.match(source, /status=in\.\(submitted,locked,consumed\)/);
  assert.match(source, /normalizeTurnSubmission/);
  assert.match(source, /fixture_id: instruction\.fixture_id \|\| null/);
  assert.match(source, /starting_xi: Array\.isArray\(instruction\.starting_xi\)/);
  assert.match(source, /bench: Array\.isArray\(instruction\.bench\)/);
});

test('current fixture submission is excluded from previous-match history', () => {
  const source = fs.readFileSync(new URL('../netlify/functions/team-seed.mjs', import.meta.url), 'utf8');
  assert.match(source, /String\(row\.fixture_id \|\| ''\) === fixtureId/);
  assert.match(source, /String\(row\.fixture_id \|\| ''\) !== fixtureId/);
  assert.match(source, /\['submitted', 'locked'\]\.includes/);
});
