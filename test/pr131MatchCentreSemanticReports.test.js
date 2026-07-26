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

test('embedded canonical player IDs are replaced inside event commentary', async () => {
  const source = await read('../netlify/functions/match-centre.mjs');
  assert.match(source, /function canonicalPlayerName/);
  assert.match(source, /function resolveCommentaryPlayerIds/);
  assert.match(source, /\\btbg\[-_:\]\[a-z0-9:_-\]\+\\b/);
  assert.match(source, /canonicalPlayerName\(world, lookup, playerId\) \|\| 'an unnamed player'/);
  assert.match(source, /player_on_id/);
  assert.match(source, /player_off_id/);
  assert.match(source, /resolvedCommentary\.replace\(\/\^A player\\b\/i, playerName\)/);
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

test('missing ratings stay null instead of becoming fake zero ratings', async () => {
  const endpoint = await read('../netlify/functions/match-centre.mjs');
  const client = await read('../public/phase2d4.js');
  assert.match(endpoint, /value === null \|\| value === undefined \|\| value === '' \? fallback/);
  assert.match(client, /value === null \|\| value === undefined \|\| value === '' \? null/);
  assert.match(client, /mcNumber\(rating\) === null \? ''/);
});

test('legacy matches explain why performance ratings are unavailable', async () => {
  const source = await read('../public/phase2d4.js');
  assert.match(source, /This match was simulated before player performance ratings were introduced\./);
  assert.match(source, /performance_ratings_version/);
  assert.match(source, /No eligible player ratings were produced for this match\./);
});

test('closing a revealed report preserves the current session and refreshes the listener target', async () => {
  const client = await read('../public/phase2d4.js');
  const divisionUi = await read('../public/phase2d3.js');
  const closeBody = client.match(/function closeMatchCentre\(\) \{([\s\S]*?)\n\}/)?.[1] || '';
  assert.doesNotMatch(closeBody, /window\.location\.reload/);
  assert.match(client, /document\.dispatchEvent\(new CustomEvent\('tbg:match-revealed'/);
  assert.doesNotMatch(client, /window\.dispatchEvent\(new CustomEvent\('tbg:match-revealed'/);
  assert.match(divisionUi, /document\.addEventListener\('tbg:match-revealed'/);
  assert.match(divisionUi, /loadDivisionRounds\(\{ force: true \}\)/);
  assert.doesNotMatch(client, /matchRevealChanged/);
});

test('canonical event subtype and outcome drive semantic display types', async () => {
  const source = await read('../netlify/functions/match-centre.mjs');
  assert.match(source, /const subtype = eventToken\(event\.subtype/);
  assert.match(source, /const outcome = eventToken\(event\.outcome/);
  assert.match(source, /subtype === 'penalty_goal'/);
  assert.match(source, /type === 'set_piece' && subtype === 'free_kick'/);
  assert.match(source, /return 'penalty_saved'/);
  assert.match(source, /return 'penalty_missed'/);
  assert.match(source, /penalty: event\.event_type === 'penalty_scored'/);
  assert.match(source, /\['goal', 'penalty_scored'\]\.includes\(event\.event_type\)/);
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
  for (const className of ['event-goal', 'event-assist', 'event-yellow', 'event-red', 'event-penalty-awarded', 'event-penalty-missed', 'event-free-kick', 'event-foul', 'event-save', 'event-defensive-action', 'event-substitution', 'event-injury']) {
    assert.match(source, new RegExp(`\\.${className}(?:,|\\{)`));
  }
  assert.match(source, /match-summary-grid/);
  assert.match(source, /@media\(max-width:760px\)/);
});
