import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { cardSummaryFromEvents, enrichReplayCommentary } from '../src/matchCentre/replayMomentDirector.js';

function fakeElement(overrides = {}) {
  const handlers = new Map();
  return {
    textContent: '', innerHTML: '', hidden: false, className: '', value: '', inserted: [],
    addEventListener(type, handler) { handlers.set(type, handler); },
    handler(type) { return handlers.get(type); },
    insertAdjacentHTML(_position, html) { this.inserted.push(html); },
    ...overrides
  };
}

test('legacy linked goal sequences receive descriptive deterministic commentary without inventing shot coordinates', () => {
  const events = enrichReplayCommentary([
    { minute: 6, side: 'home', event_type: 'set_piece', subtype: 'corner', event_id: 'corner', sequence_id: 'seq-1', sequence_order: 0, commentary: 'Real Madrid win a corner.' },
    { minute: 6, side: 'home', event_type: 'shot', event_id: 'shot', sequence_id: 'seq-1', sequence_order: 10, player_id: 'vini', player_name: 'Vinicius', xg: 0.071, outcome: 'goal', chance_origin: 'corner', linked_event_id: 'goal', commentary: 'Vinicius tests the goalkeeper.' },
    { minute: 6, side: 'home', event_type: 'goal', event_id: 'goal', sequence_id: 'seq-1', sequence_order: 20, player_id: 'vini', player_name: 'Vinicius', chance_origin: 'corner', source_event_id: 'shot', commentary: 'Vinicius scores for Real Madrid.' }
  ], { home: 'Real Madrid', away: 'Borussia Dortmund' });

  assert.match(events[1].commentary, /goalkeeper cannot get across/i);
  assert.match(events[2].commentary, /GOAL!.*superb finish.*Real Madrid/i);
  assert.doesNotMatch(events[1].commentary, /\b\d+\s*(yard|metre|meter)/i);
});

test('own goals retain the defender story instead of being rewritten as an attacking finish', () => {
  const events = enrichReplayCommentary([
    { minute: 42, side: 'home', event_type: 'shot', event_id: 'shot-og', sequence_id: 'seq-og', sequence_order: 10, player_id: 'attacker', player_name: 'Attacker', xg: 0.12, outcome: 'goal' },
    { minute: 42, side: 'home', event_type: 'goal', event_id: 'goal-og', sequence_id: 'seq-og', sequence_order: 20, player_id: 'attacker', player_name: 'Attacker', own_goal: true, own_goal_player_id: 'defender', own_goal_player_name: 'Defender', source_event_id: 'shot-og', commentary: 'Defender turns the ball into their own net.' }
  ], { home: 'Home FC', away: 'Away FC' });

  assert.match(events[1].commentary, /Defender turns the ball into their own net/i);
  assert.doesNotMatch(events[1].commentary, /Attacker.*finish|Attacker.*scores/i);
});

test('legacy two-yellow archives tell the same dismissal story in commentary and summary', () => {
  const events = enrichReplayCommentary([
    { minute: 9, side: 'home', event_type: 'yellow_card', player_id: 'cam', player_name: 'Eduardo Camavinga', commentary: 'Eduardo Camavinga is shown a yellow card.' },
    { minute: 16, side: 'home', event_type: 'yellow_card', player_id: 'cam', player_name: 'Eduardo Camavinga', commentary: 'Eduardo Camavinga is shown a yellow card.' }
  ]);
  const cards = cardSummaryFromEvents(events, 'home');

  assert.equal(events[1].display_event_type, 'second_yellow');
  assert.match(events[1].commentary, /second yellow.*sent off/i);
  assert.deepEqual(cards.map((row) => row.event_type), ['yellow_card', 'second_yellow']);
});

test('standalone second-yellow archive events remain visible in rebuilt card summaries', () => {
  const events = enrichReplayCommentary([
    { minute: 16, side: 'home', event_type: 'second_yellow', player_id: 'cam', player_name: 'Eduardo Camavinga', commentary: 'Second yellow.' }
  ]);
  const cards = cardSummaryFromEvents(events, 'home');

  assert.equal(events[0].display_event_type, 'second_yellow');
  assert.match(events[0].commentary, /sent off.*second yellow/i);
  assert.deepEqual(cards.map((row) => row.event_type), ['second_yellow']);
});

test('same-minute goal moment gets the spotlight before an unrelated substitution', async () => {
  const source = await readFile(new URL('../public/phase2d4.js', import.meta.url), 'utf8');
  const elements = new Map([
    ['replayFeed', fakeElement()], ['replayClock', fakeElement()], ['replayScore', fakeElement()],
    ['headerReplayScore', fakeElement()], ['replaySpotlight', fakeElement({ hidden: true })],
    ['replayStatus', fakeElement()], ['replayStart', fakeElement()], ['replayPause', fakeElement()],
    ['replaySkip', fakeElement()], ['replaySpeed', fakeElement({ value: '900' })]
  ]);
  let now = 1_000;
  let intervalTick = null;
  const context = vm.createContext({
    console,
    window: { fetch: async () => ({}) },
    document: { getElementById(id) { return elements.get(id) || null; }, addEventListener() {}, dispatchEvent() {} },
    Date: { now: () => now }, Request: class Request {}, Headers: class Headers {}, CustomEvent: class CustomEvent {}, Intl, encodeURIComponent,
    setInterval(callback) { intervalTick = callback; return 1; }, clearInterval() {}
  });
  vm.runInContext(source, context);
  const setupReplay = vm.runInContext('setupReplay', context);
  setupReplay({ events: [
    {
      minute: 60, side: 'away', event_type: 'substitution', commentary: 'Emre Can off · Julian Ryerson on',
      replay_presentation: { importance: 'featured', major: true, kind: 'substitution', label: 'SUBSTITUTION', hold_ms: 1000, priority: 25 }
    },
    {
      minute: 60, side: 'home', event_type: 'shot', commentary: 'Vinicius drives a fierce effort towards goal — the goalkeeper cannot keep it out.',
      sequence_id: 'seq-goal', sequence_order: 10,
      replay_presentation: { importance: 'standard', major: false, kind: 'commentary', label: null, hold_ms: 0, priority: 0, sequence_id: 'seq-goal', sequence_order: 10, sequence_role: 'build_up' }
    },
    {
      minute: 60, side: 'home', event_type: 'goal', commentary: 'GOAL! Vinicius finds the net with a superb strike for Real Madrid.',
      sequence_id: 'seq-goal', sequence_order: 20,
      replay_presentation: { importance: 'major', major: true, kind: 'goal', label: 'GOAL', hold_ms: 3200, priority: 100, sequence_id: 'seq-goal', sequence_order: 20, sequence_role: 'climax' }
    }
  ] }, false);

  elements.get('replayStart').handler('click')();
  for (let minute = 1; minute <= 60; minute += 1) intervalTick();

  assert.match(elements.get('replaySpotlight').innerHTML, /Vinicius finds the net/);
  assert.doesNotMatch(elements.get('replaySpotlight').innerHTML, /Emre Can/);
  assert.equal(elements.get('replayScore').textContent, '1-0');

  now += 3201;
  intervalTick();
  assert.match(elements.get('replaySpotlight').innerHTML, /Emre Can/);
});
