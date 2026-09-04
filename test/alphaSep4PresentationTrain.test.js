import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('mobile standings prioritise a complete high-contrast league-at-a-glance view', async () => {
  const css = await read('public/alpha-presentation-fixes.css');
  const targetedPolish = await read('public/targeted-component-polish.css');
  const brazil = await read('public/portal-brazil-pitch.css');
  const runtimeLast = await read('public/portal-dashboard-dedup.css');
  assert.match(css, /@media \(max-width: 640px\)/);
  assert.match(css, /#standingsTable/);
  for (const column of [4, 5, 6, 7, 8]) {
    assert.match(css, new RegExp(`#standingsTable th:nth-child\\(${column}\\)`));
  }
  assert.match(css, /display: none/);
  assert.match(css, /#standingsTable th:nth-child\(9\)/);
  assert.match(css, /#standingsTable th:nth-child\(10\)/);
  assert.match(css, /#standingsTable th:nth-child\(11\)/);
  assert.match(css, /#competitionsView #standingsTable thead th[\s\S]*color: #fff !important/);
  assert.match(css, /#competitionsView #standingsTable td:nth-child\(2\) \.portal-club-link/);
  assert.match(css, /white-space: normal !important/);
  assert.match(css, /text-overflow: clip !important/);
  assert.match(targetedPolish, /#standingsTable thead th \{[\s\S]*color: #fff !important/,
    'targeted polish should preserve white mobile standings headers');
  assert.match(brazil, /#portal #competitionsView \.competition-card \*/,
    'Brazil art direction has a broad descendant ink rule that can override table header contrast');
  assert.match(runtimeLast, /#portal #competitionsView \.competition-card #standingsTable thead th \{[\s\S]*color: #fff !important;[\s\S]*-webkit-text-fill-color: #fff !important/,
    'the runtime-last stylesheet must restore white standings header glyphs after the Brazil descendant rule');
});

test('5x replay filters only routine visible commentary without changing replay state', async () => {
  const css = await read('public/alpha-presentation-fixes.css');
  const behaviour = await read('public/alpha-presentation-fixes.js');
  assert.match(behaviour, /FAST_REPLAY_INTERVAL = '180'/);
  assert.match(behaviour, /modal\.dataset\.fastReplay = speed\?\.value === FAST_REPLAY_INTERVAL \? 'true' : 'false'/);
  assert.match(css, /data-fast-replay="true"/);
  assert.match(css, /\.event-foul/);
  assert.match(css, /\.event-free-kick/);
  assert.match(css, /\.event-defensive-action/);
  assert.doesNotMatch(css, /\.event-chance[^\n]*display: none/);
  assert.doesNotMatch(css, /\.event-save[^\n]*display: none/);
  assert.doesNotMatch(css, /\.event-goal[^\n]*display: none/);
  assert.doesNotMatch(behaviour, /replayState/);
});

test('penalty award is prioritised before a same-minute penalty outcome', async () => {
  const behaviour = await read('public/alpha-presentation-fixes.js');
  assert.match(behaviour, /PENALTY_AWARD_PRIORITY = 110/);
  assert.match(behaviour, /type !== 'penalty_awarded'/);
  assert.match(behaviour, /priority: PENALTY_AWARD_PRIORITY/);
  assert.match(behaviour, /requestPath\(args\[0\]\) !== '\/api\/match-centre'/);
  assert.match(behaviour, /preservePenaltyCausality\(payload\)/);
});

test('presentation fixes load through existing late portal assets', async () => {
  const cssLoader = await read('public/match-centre-player-links.css');
  const jsLoader = await read('public/internal-profile-links.js');
  assert.match(cssLoader, /@import url\('\.\/alpha-presentation-fixes\.css'\)/);
  assert.match(jsLoader, /import '\.\/alpha-presentation-fixes\.js';/);
});
