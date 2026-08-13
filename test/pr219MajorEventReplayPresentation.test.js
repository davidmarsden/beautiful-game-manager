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

  for (const type of ['assist', 'tackle']) {
    const presentation = replayPresentationForEvent({ event_type: type });
    assert.equal(presentation.major, false, `${type} should remain ordinary commentary`);
    assert.equal(presentation.importance, 'standard');
    assert.equal(presentation.hold_ms, 0);
  }
});

test('bookings, set pieces, saves, injuries and substitutions are featured without pausing replay', () => {
  for (const type of ['yellow_card', 'free_kick', 'save', 'injury', 'substitution']) {
    const presentation = replayPresentationForEvent({ event_type: type });
    assert.equal(presentation.importance, 'featured', `${type} should be visually promoted`);
    assert.equal(presentation.featured, true);
    assert.equal(presentation.major, false, `${type} should not interrupt replay`);
    assert.equal(presentation.hold_ms, 0, `${type} should not add a replay hold`);
  }
});

test('canonical saved shots and big chances use the featured save presentation', () => {
  for (const event of [
    { event_type: 'shot', outcome: 'saved' },
    { event_type: 'big_chance', payload: { outcome: 'saved' } }
  ]) {
    const presentation = replayPresentationForEvent(event);
    assert.equal(presentation.importance, 'featured');
    assert.equal(presentation.kind, 'save');
    assert.equal(presentation.label, 'SAVE');
    assert.equal(presentation.major, false);
    assert.equal(presentation.hold_ms, 0);
  }

  assert.equal(replayPresentationForEvent({ event_type: 'shot', outcome: 'off_target' }).importance, 'standard');
  assert.equal(replayPresentationForEvent({ event_type: 'penalty_saved', outcome: 'saved' }).importance, 'major');
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
  assert.equal(first.events[1].replay_presentation.importance, 'featured');
  assert.equal(first.events[1].replay_presentation.major, false);
  assert.equal(first.events[2].replay_presentation.kind, 'dismissal');
});

test('a canonical second booking is presented as a dismissal without rewriting the archived event type', () => {
  const archived = {
    fixture: { world_id: 'world-1', home_club_id: 'home', away_club_id: 'away' },
    events: [
      { minute: 21, side: 'away', event_type: 'yellow_card', player_id: 'p7', player_name: 'Twice Booked' },
      { minute: 38, side: 'home', event_type: 'yellow_card', player_id: 'p8', player_name: 'Other Player' },
      { minute: 64, side: 'away', event_type: 'yellow_card', player_id: 'p7', player_name: 'Twice Booked' }
    ],
    submissions: [],
    summary: { scorers: { home: [], away: [] }, cards: { home: [], away: [] }, top_ratings: [] },
    player_performances: { home: [], away: [] }
  };

  const decorated = decorateMatchCentrePayload(archived, null);
  assert.equal(decorated.events[0].event_type, 'yellow_card');
  assert.equal(decorated.events[0].replay_presentation.importance, 'featured');
  assert.equal(decorated.events[0].replay_presentation.major, false);
  assert.equal(decorated.events[1].replay_presentation.major, false);
  assert.equal(decorated.events[2].event_type, 'yellow_card');
  assert.equal(decorated.events[2].replay_presentation.label, 'SECOND YELLOW');
  assert.equal(decorated.events[2].replay_presentation.kind, 'dismissal');
  assert.equal(decorated.events[2].replay_presentation.major, true);
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

test('featured event hierarchy is loaded as a separate non-blocking presentation layer', async () => {
  const loader = await read('../public/match-centre-player-links.css');
  const css = await read('../public/replay-event-hierarchy.css');

  assert.match(loader, /replay-event-hierarchy\.css/);
  assert.match(css, /data-replay-importance="featured"/);
  assert.match(css, /event-yellow-card/);
  assert.match(css, /event-free-kick/);
  assert.match(css, /event-save/);
  assert.match(css, /event-injury/);
  assert.match(css, /event-substitution/);
  assert.match(css, /tbg-goal-net-ripple/);
  assert.match(css, /tbg-goal-spark-burst/);
  assert.match(css, /tbg-dismissal-flash/);
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
