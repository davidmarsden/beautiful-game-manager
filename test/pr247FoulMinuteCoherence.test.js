import test from 'node:test';
import assert from 'node:assert/strict';
import { spreadDuplicateOrdinaryFoulMinutes } from '../src/matchEngine/modules/MatchResolution.js';

test('same player ordinary fouls are spread across adjacent minutes without dropping events', () => {
  const events = [
    { event_id: 'away-foul-9', minute: 63, side: 'away', type: 'foul', subtype: 'ordinary_foul', player_id: 'away-player' },
    { event_id: 'home-foul-10', minute: 63, side: 'home', type: 'foul', subtype: 'ordinary_foul', player_id: 'palmer' },
    { event_id: 'home-foul-4', minute: 63, side: 'home', type: 'foul', subtype: 'ordinary_foul', player_id: 'palmer' }
  ];

  const coherent = spreadDuplicateOrdinaryFoulMinutes(events);
  assert.equal(coherent.length, 3);
  assert.deepEqual(coherent.map((event) => event.event_id), ['away-foul-9', 'home-foul-10', 'home-foul-4']);
  assert.equal(coherent[0].minute, 63);
  assert.equal(coherent[1].minute, 63);
  assert.equal(coherent[2].minute, 64);
});

test('different players can still commit fouls in the same minute', () => {
  const coherent = spreadDuplicateOrdinaryFoulMinutes([
    { event_id: 'home-foul-1', minute: 63, side: 'home', type: 'foul', subtype: 'ordinary_foul', player_id: 'player-a' },
    { event_id: 'home-foul-2', minute: 63, side: 'home', type: 'foul', subtype: 'ordinary_foul', player_id: 'player-b' }
  ]);
  assert.deepEqual(coherent.map((event) => event.minute), [63, 63]);
});

test('linked penalty fouls are never retimed by ordinary-foul coherence', () => {
  const coherent = spreadDuplicateOrdinaryFoulMinutes([
    { event_id: 'penalty-foul-1', minute: 75, side: 'home', type: 'foul', subtype: 'penalty_foul', player_id: 'player-a', linked_event_id: 'penalty-award-1' },
    { event_id: 'penalty-foul-2', minute: 75, side: 'home', type: 'foul', subtype: 'penalty_foul', player_id: 'player-a', linked_event_id: 'penalty-award-2' }
  ]);
  assert.deepEqual(coherent.map((event) => event.minute), [75, 75]);
});
