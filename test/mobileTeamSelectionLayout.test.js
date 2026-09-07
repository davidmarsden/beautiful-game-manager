import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const formationCss = fs.readFileSync(new URL('../public/formation-board.css', import.meta.url), 'utf8');
const fitnessCss = fs.readFileSync(new URL('../public/team-selection-fitness.css', import.meta.url), 'utf8');

test('mobile formation board uses compact non-overlapping pitch cards', () => {
  assert.match(formationCss, /@media\(max-width:600px\)/);
  assert.match(formationCss, /\.formation-slot\{width:72px;min-height:50px/);
  assert.match(formationCss, /\.formation-slot \.player-token small,\.formation-slot \.versatility-fit\{display:none!important\}/);
  assert.match(formationCss, /\.formation-slot \.player-token strong\{font-size:9px[\s\S]*white-space:nowrap\}/);
});

test('small phones get a second compact breakpoint', () => {
  assert.match(formationCss, /@media\(max-width:390px\)/);
  assert.match(formationCss, /\.formation-slot\{width:66px\}/);
});

test('pitch fitness information stays visible without expanding mobile cards', () => {
  assert.match(fitnessCss, /@media\(max-width:600px\)/);
  assert.match(fitnessCss, /\.football-pitch \.formation-slot\{min-height:50px\}/);
  assert.match(fitnessCss, /\.football-pitch \.fitness-metrics\{display:block[\s\S]*white-space:nowrap[\s\S]*text-overflow:ellipsis\}/);
  assert.match(fitnessCss, /\.football-pitch \.fitness-metrics small\{display:none\}/);
});
