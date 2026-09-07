import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const formationCss = fs.readFileSync(new URL('../public/formation-board.css', import.meta.url), 'utf8');
const fitnessCss = fs.readFileSync(new URL('../public/team-selection-fitness.css', import.meta.url), 'utf8');

test('mobile formation board uses compact non-overlapping pitch cards', () => {
  assert.match(formationCss, /@media\(max-width:600px\)/);
  assert.match(formationCss, /\.formation-slot\{width:min\(72px,18%\);min-height:50px/);
  assert.match(formationCss, /\.formation-slot \.player-token small,\.formation-slot \.versatility-fit\{display:none!important\}/);
});

test('mobile pitch names use the card width and can wrap to two readable lines', () => {
  assert.match(formationCss, /\.formation-slot \.player-token\{grid-template-columns:1fr;gap:1px;justify-items:center\}/);
  assert.match(formationCss, /\.formation-slot \.player-token strong\{display:-webkit-box[\s\S]*white-space:normal[\s\S]*overflow-wrap:anywhere[\s\S]*-webkit-line-clamp:2/);
});

test('small phones keep proportional slot sizing for closest 20 percent formation spacing', () => {
  assert.match(formationCss, /@media\(max-width:390px\)/);
  assert.match(formationCss, /\.formation-slot\{width:min\(66px,18%\)\}/);
});

test('pitch fitness information stays visible without expanding mobile cards', () => {
  assert.match(fitnessCss, /@media\(max-width:600px\)/);
  assert.match(fitnessCss, /\.football-pitch \.formation-slot\{min-height:50px\}/);
  assert.match(fitnessCss, /\.football-pitch \.fitness-metrics\{display:block[\s\S]*white-space:nowrap[\s\S]*text-overflow:ellipsis\}/);
  assert.match(fitnessCss, /\.football-pitch \.fitness-metrics small\{display:none\}/);
});
