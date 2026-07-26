import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('match centre resolves canonical player names without invented minute-based attribution', async () => {
  const source = await read('../netlify/functions/match-centre.mjs');
  assert.match(source, /function resolvePlayerName/);
  assert.match(source, /world\.squad_cycle\?\.players/);
  assert.match(source, /result\?\.teams/);
  assert.match(source, /submissions/);
  assert.match(source, /prettyId/);
  assert.doesNotMatch(source, /\(Number\(event\.minute \|\| 0\) \+ index\) % ids\.length/);
});

test('match centre projects scorers, cards and normalized player performances', async () => {
  const source = await read('../netlify/functions/match-centre.mjs');
  assert.match(source, /player_performances/);
  assert.match(source, /player_of_the_match/);
  assert.match(source, /top_ratings/);
  assert.match(source, /scorers: \{ home:/);
  assert.match(source, /cards: \{/);
  assert.match(source, /function rawRatingRows/);
  assert.match(source, /minutes_played/);
});

test('report and replay share centralized semantic event metadata', async () => {
  const source = await read('../public/phase2d4.js');
  assert.match(source, /const eventTypeMeta =/);
  assert.match(source, /penalty_scored/);
  assert.match(source, /second_yellow/);
  assert.match(source, /free_kick/);
  assert.match(source, /eventMarkup\(event/);
  assert.match(source, /events\.map\(\(event\) => eventMarkup\(event\)\)/);
  assert.match(source, /insertAdjacentHTML\('afterbegin', eventMarkup\(event, \{ replay: true \}\)\)/);
});

test('summary and lineups expose ratings and key contributions', async () => {
  const source = await read('../public/phase2d4.js');
  assert.match(source, /PLAYER OF THE MATCH/);
  assert.match(source, /topRatingsMarkup/);
  assert.match(source, /player-contributions/);
  assert.match(source, /match-rating/);
  assert.match(source, /goals/);
  assert.match(source, /assists/);
});

test('dark-theme semantic event treatments remain responsive', async () => {
  const source = await read('../public/phase2d4.css');
  for (const className of ['event-goal', 'event-assist', 'event-yellow', 'event-red', 'event-penalty-awarded', 'event-penalty-missed', 'event-free-kick', 'event-foul', 'event-save', 'event-defensive', 'event-substitution', 'event-injury']) {
    assert.match(source, new RegExp(`\\.${className}(?:,|\\{)`));
  }
  assert.match(source, /match-summary-grid/);
  assert.match(source, /@media\(max-width:760px\)/);
});
