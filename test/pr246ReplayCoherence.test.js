import test from 'node:test';
import assert from 'node:assert/strict';
import { enrichReplayCommentary } from '../src/matchCentre/replayMomentDirector.js';

test('replay enrichment is idempotent for generated chance outcome reveals', () => {
  const source = [
    {
      minute: 37,
      side: 'home',
      event_type: 'shot',
      event_id: 'alvarez-37-shot',
      sequence_id: 'alvarez-37',
      sequence_order: 10,
      player_id: 'alvarez',
      player_name: 'Julián Alvarez',
      xg: 0.12,
      outcome: 'wide'
    }
  ];

  const once = enrichReplayCommentary(source);
  const twice = enrichReplayCommentary(once);
  const threeTimes = enrichReplayCommentary(twice);

  assert.equal(once.filter((event) => event.display_event_type === 'chance_missed').length, 1);
  assert.equal(twice.filter((event) => event.display_event_type === 'chance_missed').length, 1);
  assert.equal(threeTimes.filter((event) => event.display_event_type === 'chance_missed').length, 1);
  assert.equal(threeTimes.filter((event) => /effort goes wide/i.test(event.commentary || '')).length, 1);
});

test('duplicate source events with the same event id do not create repeated outcome reveals', () => {
  const duplicate = {
    minute: 37,
    side: 'home',
    event_type: 'shot',
    event_id: 'alvarez-37-shot',
    sequence_id: 'alvarez-37',
    sequence_order: 10,
    player_id: 'alvarez',
    player_name: 'Julián Alvarez',
    xg: 0.12,
    outcome: 'wide'
  };
  const events = enrichReplayCommentary([duplicate, { ...duplicate }, { ...duplicate }]);

  assert.equal(events.filter((event) => event.event_id === 'alvarez-37-shot').length, 1);
  assert.equal(events.filter((event) => event.event_id === 'alvarez-37-shot:outcome').length, 1);
});

test('explicit second-yellow dismissal suppresses the duplicate ordinary second booking beat', () => {
  const events = enrichReplayCommentary([
    { minute: 22, side: 'home', event_type: 'yellow_card', event_id: 'chalobah-yellow-1', player_id: 'chalobah', player_name: 'Trevoh Chalobah' },
    { minute: 75, side: 'home', event_type: 'yellow_card', event_id: 'chalobah-yellow-2', player_id: 'chalobah', player_name: 'Trevoh Chalobah' },
    { minute: 75, side: 'home', event_type: 'red_card', subtype: 'second_yellow', event_id: 'chalobah-red', player_id: 'chalobah', player_name: 'Trevoh Chalobah' }
  ]);

  assert.equal(events.filter((event) => event.event_id === 'chalobah-yellow-2').length, 0);
  assert.equal(events.filter((event) => event.display_event_type === 'second_yellow').length, 1);
  assert.match(events.find((event) => event.event_id === 'chalobah-red')?.commentary || '', /sent off.*second yellow/i);
});
