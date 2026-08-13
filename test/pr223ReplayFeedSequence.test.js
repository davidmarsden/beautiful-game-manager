import test from 'node:test';
import assert from 'node:assert/strict';

function replayRow(minute) {
  return {
    hidden: false,
    querySelector(selector) {
      return selector === 'time' ? { textContent: `${minute}'` } : null;
    }
  };
}

test('same-minute replay rows are revealed in queue order', async () => {
  globalThis.document = { documentElement: {}, addEventListener() {} };
  globalThis.MutationObserver = class { observe() {} };

  const { syncQueuedReplayFeedVisibility } = await import(`../public/replay-feed-queue-visibility.js?sequence=${Date.now()}`);
  const first = replayRow(90);
  const second = replayRow(90);
  const feed = { querySelectorAll: () => [second, first] };
  const spotlight = { hidden: false, querySelector: () => ({ textContent: "90'" }) };
  const root = {
    getElementById(id) {
      if (id === 'replayFeed') return feed;
      if (id === 'replaySpotlight') return spotlight;
      return null;
    }
  };

  syncQueuedReplayFeedVisibility(root);
  assert.equal(first.hidden, false);
  assert.equal(second.hidden, true);

  syncQueuedReplayFeedVisibility(root);
  assert.equal(first.hidden, false);
  assert.equal(second.hidden, false);
});
