import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');

test('competition views render portal-wide club identity links', () => {
  const source = read('../public/phase2d3.js');
  assert.match(source, /class="\$\{className\}" data-club-id/);
  assert.match(source, /clubLink\(row\.club_id, row\.club_name\)/);
  assert.match(source, /clubLink\(fixture\.opponent_id, fixture\.opponent_name\)/);
});

test('club identity links support keyboard activation and isolate match-centre actions', () => {
  const inspection = read('../public/club-inspection.js');
  const matchCentre = read('../public/phase2d4.js');
  assert.match(inspection, /\['Enter', ' '\]\.includes\(event\.key\)/);
  assert.match(inspection, /event\.stopImmediatePropagation\(\)/);
  assert.match(matchCentre, /event\.target\.closest\('\[data-club-id\]'\)\) return/);
  assert.match(matchCentre, /event\.target\.closest\?\.\('\[data-club-id\]'\)\) return/);
});

test('portal club links have visible hover and focus affordances', () => {
  const css = read('../public/phase2d3.css');
  assert.match(css, /\.portal-club-link\{/);
  assert.match(css, /cursor:pointer/);
  assert.match(css, /text-decoration:underline/);
  assert.match(css, /\.portal-club-link:focus-visible\{/);
});
