import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const formationCss = fs.readFileSync(new URL('../public/formation-board.css', import.meta.url), 'utf8');
const fitnessCss = fs.readFileSync(new URL('../public/team-selection-fitness.css', import.meta.url), 'utf8');
const portalProjection = fs.readFileSync(new URL('../src/world/managerPortalProjection.js', import.meta.url), 'utf8');
const alphaTeamUx = fs.readFileSync(new URL('../public/alpha-team-ux-fixes.js', import.meta.url), 'utf8');
const design1982 = fs.readFileSync(new URL('../public/design-1982.css', import.meta.url), 'utf8');

test('mobile formation board uses compact non-overlapping pitch cards', () => {
  assert.match(formationCss, /@media\(max-width:600px\)/);
  assert.match(formationCss, /\.formation-slot\{width:min\(72px,18%\);min-height:46px/);
  assert.match(formationCss, /\.formation-slot \.player-token small,\.formation-slot \.versatility-fit\{display:none!important\}/);
});

test('mobile cards put rating and fitness on the same row with the name below', () => {
  assert.match(formationCss, /grid-template-areas:"rating fitness" "name name"/);
  assert.match(formationCss, /\.formation-slot \.player-rating\{grid-area:rating/);
  assert.match(formationCss, /\.formation-slot \.player-token>span:nth-child\(2\)\{grid-area:name/);
  assert.match(fitnessCss, /\.football-pitch \.fitness-metrics\{grid-area:fitness/);
  assert.match(formationCss, /\.formation-slot \.player-token strong\{display:-webkit-box[\s\S]*-webkit-line-clamp:2/);
});

test('mobile cards can use extra width for isolated central roles', () => {
  assert.match(formationCss, /\.formation-slot\[data-role="GK"\],\.formation-slot\[data-role="CF"\],\.formation-slot\[data-role="AM"\]\{width:min\(96px,24%\)\}/);
});

test('small phones keep proportional slot sizing for closest 20 percent formation spacing', () => {
  assert.match(formationCss, /@media\(max-width:390px\)/);
  assert.match(formationCss, /\.formation-slot\{width:min\(66px,18%\);min-height:44px\}/);
});

test('pitch fitness information stays visible without expanding mobile cards', () => {
  assert.match(fitnessCss, /@media\(max-width:600px\)/);
  assert.match(fitnessCss, /\.football-pitch \.formation-slot\{min-height:46px\}/);
  assert.match(fitnessCss, /\.football-pitch \.fitness-metrics\{grid-area:fitness;display:block[\s\S]*white-space:nowrap[\s\S]*text-overflow:ellipsis\}/);
  assert.match(fitnessCss, /\.football-pitch \.fitness-metrics small\{display:none\}/);
});

test('phone layout survives browsers requesting a desktop viewport', () => {
  const fallback = /@media \(hover:none\) and \(pointer:coarse\) and \(max-device-width:600px\)/;
  assert.match(formationCss, fallback);
  assert.match(fitnessCss, fallback);
  assert.match(formationCss, /max-device-width:600px\)\{#tacticsView \.formation-board-shell\{grid-template-columns:1fr!important/);
  assert.match(formationCss, /max-device-width:600px\)[\s\S]*\.formation-slot\{width:min\(72px,18%\);min-height:46px/);
});

test('desktop-site phone fallback outranks later desktop two-column rules', () => {
  assert.match(design1982, /\.formation-board-shell\{[^}]*grid-template-columns:minmax\(0,1\.68fr\)/);
  assert.match(alphaTeamUx, /#tacticsView \.formation-board-shell \{[\s\S]*grid-template-columns:[^;]+!important/);
  assert.match(formationCss, /#tacticsView \.formation-board-shell\{grid-template-columns:1fr!important/);
});

test('manager portal prefers football display names when canonical player data provides them', () => {
  assert.match(portalProjection, /function preferredFootballName/);
  assert.match(portalProjection, /player\.known_as[\s\S]*player\.short_name[\s\S]*player\.nickname[\s\S]*player\.nicknames[\s\S]*player\.display_name/);
  assert.match(portalProjection, /display_name: preferredFootballName\(player\)/);
});
