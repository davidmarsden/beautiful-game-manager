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
  assert.ok(endpoint.includes('const item = (feed?.items || []).find'));
});

test('World Feed uses layered Football Pink surfaces instead of white cards', () => {
  assert.ok(css.includes('background:#f8dfe8'));
  assert.ok(css.includes('background:#f5cfdd'));
  assert.ok(css.includes('background:#fcebf1'));
  assert.equal(css.includes('.world-feed-composer,.world-feed-item{background:#fff'), false);
});
