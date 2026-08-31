import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const ui = fs.readFileSync(new URL('../public/world-feed.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../public/world-feed.css', import.meta.url), 'utf8');
const endpoint = fs.readFileSync(new URL('../netlify/functions/world-feed.mjs', import.meta.url), 'utf8');

test('World Feed mutations patch only the affected DOM instead of reloading the whole feed', () => {
  assert.ok(ui.includes('replaceFeedItem(result.item)'));
  assert.ok(ui.includes('prependFeedItem(result.item)'));
  assert.ok(ui.includes('data-feed-item-id') || ui.includes('dataset.feedItemId'));
  assert.ok(endpoint.includes('async function bestEffortFeedItem'));
  assert.ok(endpoint.includes('return null;'));
});

test('World Feed uses the dark Brazil palette with pale content reserved for inputs and comments', () => {
  assert.ok(css.includes('background:#193375'));
  assert.ok(css.includes('background:#102f42'));
  assert.ok(css.includes('background:#164b2a'));
  assert.ok(css.includes('background:#e8eee4'));
  for (const legacyPink of ['#f2b9ce','#c77998','#f8dfe8','#d8a7ba','#f5cfdd','#c994a8','#fdf2f6','#d06e96','#3c2530','#f8dce7','#f6d5e2','#f9e3eb','#f1bdd0','#d986a8','#fcebf1','#f9e7ee']) {
    assert.equal(css.includes(legacyPink), false, `legacy World Feed pink ${legacyPink} must not return`);
  }
});
