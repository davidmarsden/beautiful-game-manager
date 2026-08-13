import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const sourceUrl = new URL('../public/phase2d4.js', import.meta.url);

function fakeElement(overrides = {}) {
  const handlers = new Map();
  return {
    textContent: '',
    innerHTML: '',
    hidden: false,
    className: '',
    value: '',
    inserted: [],
    addEventListener(type, handler) { handlers.set(type, handler); },
    handler(type) { return handlers.get(type); },
    insertAdjacentHTML(_position, html) { this.inserted.push(html); },
    ...overrides
  };
}

test('same-minute replay moments are held sequentially with score snapshots before full time', async () => {
  const source = await readFile(sourceUrl, 'utf8');
  const elements = new Map([
    ['replayFeed', fakeElement()],
    ['replayClock', fakeElement()],
    ['replayScore', fakeElement()],
    ['headerReplayScore', fakeElement()],
    ['replaySpotlight', fakeElement({ hidden: true })],
    ['replayStatus', fakeElement()],
    ['replayStart', fakeElement()],
    ['replayPause', fakeElement()],
    ['replaySkip', fakeElement()],
    ['replaySpeed', fakeElement({ value: '900' })]
  ]);

  let now = 1_000;
  let intervalTick = null;
  const context = vm.createContext({
    console,
    window: { fetch: async () => ({}) },
    document: {
      getElementById(id) { return elements.get(id) || null; },
      addEventListener() {},
      dispatchEvent() {}
    },
    Date: { now: () => now },
    Request: class Request {},
    Headers: class Headers {},
    CustomEvent: class CustomEvent {},
    Intl,
    encodeURIComponent,
    setInterval(callback) { intervalTick = callback; return 1; },
    clearInterval() {}
  });

  vm.runInContext(source, context);
  const setupReplay = vm.runInContext('setupReplay', context);
  setupReplay({
    events: [
      {
        minute: 90,
        side: 'home',
        event_type: 'goal',
        player_name: 'First Scorer',
        commentary: 'First Scorer equalises.',
        replay_presentation: { importance: 'major', major: true, kind: 'goal', label: 'GOAL', hold_ms: 3200, priority: 100 }
      },
      {
        minute: 90,
        side: 'home',
        event_type: 'goal',
        player_name: 'Second Scorer',
        commentary: 'Second Scorer wins it.',
        replay_presentation: { importance: 'major', major: true, kind: 'goal', label: 'GOAL', hold_ms: 3200, priority: 100 }
      }
    ]
  }, false);

  elements.get('replayStart').handler('click')();
  assert.equal(typeof intervalTick, 'function');

  for (let minute = 1; minute <= 90; minute += 1) intervalTick();

  assert.equal(elements.get('replayClock').textContent, "90'");
  assert.equal(elements.get('replayScore').textContent, '1-0', 'first queued goal should expose only its score state');
  assert.match(elements.get('replaySpotlight').innerHTML, /First Scorer equalises/);
  assert.doesNotMatch(elements.get('replayFeed').inserted.join('\n'), /FULL TIME/);

  now += 3201;
  intervalTick();
  assert.equal(elements.get('replayScore').textContent, '2-0', 'second queued goal should then expose the winning score');
  assert.match(elements.get('replaySpotlight').innerHTML, /Second Scorer wins it/);
  assert.doesNotMatch(elements.get('replayFeed').inserted.join('\n'), /FULL TIME/);

  now += 3201;
  intervalTick();
  assert.match(elements.get('replayFeed').inserted.join('\n'), /FULL TIME/);
  assert.equal(elements.get('replayStatus').textContent, 'FT');
});

test('replay source explicitly clears queued moments when skipping or restarting', async () => {
  const source = await readFile(sourceUrl, 'utf8');
  assert.match(source, /spotlightQueue:\s*\[\]/);
  assert.match(source, /minuteMoments\.push\(\{ event, home: replayState\.home, away: replayState\.away \}\)/);
  assert.match(source, /showReplaySpotlight\(replayState\.spotlightQueue\.shift\(\)\)/);
  assert.match(source, /replayState\.spotlightQueue = \[\]/);
  assert.match(source, /ignoreHold: true, suppressSpotlight: true/);
});
