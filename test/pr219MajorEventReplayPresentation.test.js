import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  decorateMatchCentrePayload,
  replayPresentationForEvent
} from '../netlify/functions/match-centre-linked.mjs';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('goals, penalties and dismissals are classified as durable major replay moments', () => {
  for (const type of ['goal', 'penalty_scored']) {
    const presentation = replayPresentationForEvent({ event_type: type });
    assert.equal(presentation.major, true);
    assert.equal(presentation.kind, 'goal');
    assert.ok(presentation.hold_ms >= 2800);
    assert.equal(presentation.priority, 100);
  }

  for (const type of ['penalty_awarded', 'penalty_missed', 'penalty_saved', 'red_card', 'second_yellow']) {
    const presentation = replayPresentationForEvent({ event_type: type });
    assert.equal(presentation.major, true, `${type} should interrupt ordinary replay`);
    assert.ok(presentation.hold_ms >= 2200, `${type} should remain visible long enough to register`);
  }

  for (const type of ['yellow_card', 'assist', 'save', 'tackle', 'substitution']) {
    const presentation = replayPresentationForEvent({ event_type: type });
    assert.equal(presentation.major, false, `${type} should remain ordinary commentary`);
    assert.equal(presentation.hold_ms, 0);
  }
});

test('major-event presentation is derived reproducibly from archived events on every load', () => {
  const archived = {
    fixture: { world_id: 'world-1', home_club_id: 'home', away_club_id: 'away' },
    events: [
      { minute: 18, side: 'home', event_type: 'goal', player_id: 'p1', player_name: 'Scorer' },
      { minute: 44, side: 'away', event_type: 'yellow_card', player_id: 'p2', player_name: 'Booked Player' },
      { minute: 72, side: 'away', event_type: 'red_card', player_id: 'p3', player_name: 'Dismissed Player' }
    ],
    submissions: [],
    summary: { scorers: { home: [], away: [] }, cards: { home: [], away: [] }, top_ratings: [] },
    player_performances: { home: [], away: [] }
  };

  const first = decorateMatchCentrePayload(archived, null);
  const reloaded = decorateMatchCentrePayload(archived, null);
  assert.deepEqual(first.events.map((event) => event.replay_presentation), reloaded.events.map((event) => event.replay_presentation));
  assert.equal(first.events[0].replay_presentation.label, 'GOAL');
  assert.equal(first.events[0].replay_presentation.major, true);
  assert.equal(first.events[1].replay_presentation.major, false);
  assert.equal(first.events[2].replay_presentation.kind, 'dismissal');
});

test('browser replay spotlight holds major moments independently of replay speed and skip bypasses holds', async () => {
  const browser = await read('../public/phase2d4.js');
  const css = await read('../public/match-centre-major-events.css');

  assert.match(browser, /replay_presentation/);
  assert.match(browser, /id="replaySpotlight"/);
  assert.match(browser, /holdUntil/);
  assert.match(browser, /Date\.now\(\) \+ Math\.max/);
  assert.match(browser, /ignoreHold = false/);
  assert.match(browser, /suppressSpotlight = false/);
  assert.match(browser, /tick\(\{ autoFinish: false, ignoreHold: true, suppressSpotlight: true \}\)/);
  assert.match(browser, /pendingFinish/);
  assert.match(css, /\.replay-spotlight/);
  assert.match(css, /\.match-event\.major-event/);
  assert.match(css, /spotlight-goal/);
  assert.match(css, /prefers-reduced-motion/);
});

test('spoiler-safe replay still starts at nil-nil and reveals the canonical result only through the reveal path', async () => {
  const browser = await read('../public/phase2d4.js');
  assert.match(browser, /id="headerReplayScore">0-0</);
  assert.match(browser, /id="replayScore">0-0</);
  assert.match(browser, /RESULT HIDDEN/);
  assert.match(browser, /replayState\[event\.side\] \+= 1/);
  assert.match(browser, /finish\('replay_completed'\)/);
  assert.match(browser, /finish\('skip_to_full_time'\)/);
});
