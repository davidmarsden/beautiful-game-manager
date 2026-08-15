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

test('linked goal attempts describe only the attempt and leave the outcome for the goal reveal', () => {
  const events = enrichReplayCommentary([
    { minute: 6, side: 'home', event_type: 'set_piece', subtype: 'corner', event_id: 'corner', sequence_id: 'seq-1', sequence_order: 0, commentary: 'Real Madrid win a corner.' },
    { minute: 6, side: 'home', event_type: 'shot', event_id: 'shot', sequence_id: 'seq-1', sequence_order: 10, player_id: 'vini', player_name: 'Vinicius', xg: 0.071, outcome: 'goal', chance_origin: 'corner', linked_event_id: 'goal', commentary: 'Vinicius tests the goalkeeper.' },
    { minute: 6, side: 'home', event_type: 'goal', event_id: 'goal', sequence_id: 'seq-1', sequence_order: 20, player_id: 'vini', player_name: 'Vinicius', chance_origin: 'corner', source_event_id: 'shot', commentary: 'Vinicius scores for Real Madrid.', replay_presentation: { importance: 'major', major: true, kind: 'goal', label: 'GOAL', hold_ms: 2800, priority: 100, sequence_id: 'seq-1', sequence_order: 20, sequence_role: 'climax' } }
  ], { home: 'Real Madrid', away: 'Borussia Dortmund' });

  assert.match(events[1].commentary, /attacks the corner.*effort away/i);
  assert.doesNotMatch(events[1].commentary, /goalkeeper|save|saved|wide|woodwork|goal|net|beats?/i);
  assert.equal(events[1].replay_presentation.major, true);
  assert.equal(events[1].replay_presentation.label, 'CHANCE');
  assert.match(events[2].commentary, /GOAL!.*superb finish.*Real Madrid/i);
  assert.doesNotMatch(events[1].commentary, /\b\d+\s*(yard|metre|meter)/i);
});

test('non-goal attempts get a separate display-only outcome reveal', () => {
  const cases = [
    ['saved', 'chance_saved', /goalkeeper.*save/i],
    ['missed', 'chance_missed', /goes wide/i],
    ['woodwork', 'chance_woodwork', /woodwork/i],
    ['offside', 'chance_offside', /offside/i]
  ];
  for (const [outcome, displayType, revealPattern] of cases) {
    const events = enrichReplayCommentary([
      { minute: 20, side: 'away', event_type: 'shot', event_id: `shot-${outcome}`, sequence_id: `seq-${outcome}`, sequence_order: 10, player_id: 'p1', player_name: 'Player One', xg: 0.2, outcome }
    ]);
    assert.equal(events.length, 2);
    assert.equal(events[0].display_event_type, 'chance_attempt');
    assert.doesNotMatch(events[0].commentary, /goalkeeper|save|saved|wide|woodwork|offside|goal|net/i);
    assert.equal(events[1].display_only, true);
    assert.equal(events[1].display_event_type, displayType);
    assert.match(events[1].commentary, revealPattern);
    assert.equal(events[1].replay_presentation.major, true);
  }
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

test('corner, chance and goal are revealed as separate paused beats without feed spoilers', async () => {
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

  const chanceEvents = enrichReplayCommentary([
    { minute: 60, side: 'home', event_type: 'set_piece', subtype: 'corner', event_id: 'corner', sequence_id: 'seq-goal', sequence_order: 0, commentary: 'Real Madrid win a corner.' },
    { minute: 60, side: 'home', event_type: 'shot', event_id: 'shot', sequence_id: 'seq-goal', sequence_order: 10, player_id: 'vini', player_name: 'Vinicius', xg: 0.11, outcome: 'goal', chance_origin: 'corner' },
    { minute: 60, side: 'home', event_type: 'goal', event_id: 'goal', sequence_id: 'seq-goal', sequence_order: 20, player_id: 'vini', player_name: 'Vinicius', chance_origin: 'corner', source_event_id: 'shot', replay_presentation: { importance: 'major', major: true, kind: 'goal', label: 'GOAL', hold_ms: 2800, priority: 100, sequence_id: 'seq-goal', sequence_order: 20, sequence_role: 'climax' } },
    { minute: 60, side: 'away', event_type: 'substitution', commentary: 'Emre Can off · Julian Ryerson on', replay_presentation: { importance: 'featured', major: true, kind: 'substitution', label: 'SUBSTITUTION', hold_ms: 1000, priority: 25 } }
  ], { home: 'Real Madrid', away: 'Borussia Dortmund' });
  setupReplay({ events: chanceEvents }, false);

  elements.get('replayStart').handler('click')();
  for (let minute = 1; minute <= 60; minute += 1) intervalTick();

  assert.match(elements.get('replaySpotlight').innerHTML, /CORNER/i);
  assert.equal(elements.get('replayScore').textContent, '0-0');
  assert.doesNotMatch(elements.get('replayFeed').inserted.join('\n'), /GOAL!/i);

  now += 1401;
  intervalTick();
  assert.match(elements.get('replaySpotlight').innerHTML, /CHANCE/i);
  assert.match(elements.get('replaySpotlight').innerHTML, /Vinicius.*effort/i);
  assert.equal(elements.get('replayScore').textContent, '0-0');
  assert.doesNotMatch(elements.get('replayFeed').inserted.join('\n'), /GOAL!/i);

  now += 1801;
  intervalTick();
  assert.match(elements.get('replaySpotlight').innerHTML, /GOAL!/i);
  assert.equal(elements.get('replayScore').textContent, '1-0');
  assert.match(elements.get('replayFeed').inserted.join('\n'), /GOAL!/i);
  assert.doesNotMatch(elements.get('replaySpotlight').innerHTML, /Emre Can/);

  now += 2801;
  intervalTick();
  assert.match(elements.get('replaySpotlight').innerHTML, /Emre Can/);
});
