import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const css = fs.readFileSync(new URL('../public/tbg-green-stock.css', import.meta.url), 'utf8');

test('TBG identity uses the canonical Brazil football source colours', () => {
  assert.ok(css.includes('--tbg-brazil-yellow:#FFDC02'));
  assert.ok(css.includes('--tbg-brazil-green:#19AE47'));
  assert.ok(css.includes('--tbg-brazil-blue:#193375'));
  assert.ok(css.includes('--tbg-brazil-sky:#0C87D1'));
  assert.ok(css.includes('--tbg-brazil-white:#FFFFFF'));
});

test('Brazil accents are reserved for chrome and highlights rather than whole-page saturation', () => {
  assert.ok(css.includes('.topbar,.tabs{background:var(--tbg-brazil-blue)!important'));
  assert.ok(css.includes('.tabs button.active{background:var(--tbg-brazil-yellow)!important'));
  assert.ok(css.includes('--tbg-surface-card:#f5f9ef'));
  assert.ok(css.includes('--tbg-colour-workspace:#c9dfb7'));
});

test('known late Football Pink surfaces are explicitly remapped for TBG', () => {
  assert.ok(css.includes('#dashboardView .inbox-message'));
  assert.ok(css.includes('#worldView .world-control-summary article'));
  assert.ok(css.includes('#tacticsView .tray-player'));
  assert.ok(css.includes('#competitionsView .division-round-fixture'));
  assert.ok(css.includes('background:var(--tbg-surface-card)!important'));
});

test('managed and selected states use Brazil yellow as the distinctive attention colour', () => {
  assert.ok(css.includes('#competitionsView .division-round-fixture.managed-fixture{background:rgba(255,220,2,.24)!important}'));
  assert.ok(css.includes('#tacticsView .formation-slot .player-rating{background:var(--tbg-brazil-yellow)!important'));
});
