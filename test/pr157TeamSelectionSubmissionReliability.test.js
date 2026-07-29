import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('reliable submission controller owns form submission before the legacy formation bridge', async () => {
  const html = await read('public/index.html');
  const controllerIndex = html.indexOf('team-selection-submission-reliability.js');
  const boardIndex = html.indexOf('formation-board.js');
  assert.ok(controllerIndex >= 0, 'reliable submission controller must be loaded');
  assert.ok(boardIndex > controllerIndex, 'controller must register its capture handler before the legacy board submit bridge');
  assert.match(html, /team-selection-submission-reliability\.css/);
});

test('submission serialises the visible pitch and bench rather than hidden checkboxes', async () => {
  const source = await read('public/team-selection-submission-reliability.js');
  assert.match(source, /#formationPitch \.formation-slot/);
  assert.match(source, /#formationBench \.bench-slot/);
  assert.match(source, /querySelector\('\.player-token'\)\?\.dataset\.playerId/);
  assert.match(source, /starting_xi: selection\.startingXi/);
  assert.match(source, /bench: selection\.bench/);
  assert.doesNotMatch(source, /input\[data-zone="xi"\]:checked/);
  assert.doesNotMatch(source, /input\[data-zone="bench"\]:checked/);
});

test('submission validates eleven starters seven substitutes and a starting captain before POST', async () => {
  const source = await read('public/team-selection-submission-reliability.js');
  assert.match(source, /startingXi\.length !== 11/);
  assert.match(source, /bench\.length !== 7/);
  assert.match(source, /new Set\(allPlayers\)\.size !== allPlayers\.length/);
  assert.match(source, /if \(!captainId\)/);
  assert.match(source, /if \(!startingXi\.includes\(captainId\)\)/);
  const validationIndex = source.indexOf('const selection = visibleSelection();');
  const postIndex = source.indexOf("nativeFetch('/api/decisions'");
  assert.ok(validationIndex >= 0 && postIndex > validationIndex, 'visible selection must be validated before the submission request');
});

test('submission exposes saving success and exact failures beside a disabled save button', async () => {
  const [source, css] = await Promise.all([
    read('public/team-selection-submission-reliability.js'),
    read('public/team-selection-submission-reliability.css')
  ]);
  assert.match(source, /button\.disabled = true/);
  assert.match(source, /button\.textContent = 'Saving…'/);
  assert.match(source, /setStatus\('Saving…'\)/);
  assert.match(source, /validation_errors/);
  assert.match(source, /invalid response/);
  assert.match(source, /empty response/);
  assert.match(source, /catch \(error\)/);
  assert.match(source, /team-submission-actions/);
  assert.match(css, /team-submission-actions/);
});

test('successful submission refreshes and renders canonical submission state', async () => {
  const source = await read('public/team-selection-submission-reliability.js');
  assert.match(source, /const refreshed = await bootstrapState\(\)/);
  assert.match(source, /renderCanonicalSubmission\(refreshed\)/);
  assert.match(source, /current_submission/);
  assert.match(source, /tbg:team-submission-saved/);
});
