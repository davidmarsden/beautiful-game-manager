import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const css = fs.readFileSync(new URL('../public/tbg-brazil-polish.css', import.meta.url), 'utf8');
const community = fs.readFileSync(new URL('../public/community-card.js', import.meta.url), 'utf8');

test('TBG paper green is deliberately deeper than the first Brazil pass', () => {
  assert.ok(css.includes('--tbg-colour-paper:#9fc785'));
  assert.ok(css.includes('--tbg-colour-workspace:#b8d69f'));
  assert.ok(community.includes("loadStylesheet('tbg-brazil-polish.css')"));
});

test('World Feed comments and controls no longer inherit Football Pink', () => {
  assert.ok(css.includes('.world-feed-comment{background:#fff!important'));
  assert.ok(css.includes('.world-feed-type,.world-feed-pin-badge'));
  assert.ok(css.includes('.world-feed-pin-action'));
  assert.ok(css.includes('.world-feed-manager_post{border-left-color:var(--tbg-brazil-green)!important}'));
});

test('player profile is integrated with the Brazil TBG identity', () => {
  assert.ok(css.includes('.tbg-player-profile{background:var(--tbg-brazil-blue)!important'));
  assert.ok(css.includes('.tbg-player-rating{background:linear-gradient(145deg,var(--tbg-brazil-green)'));
  assert.ok(css.includes('.tbg-profile-tabs button.active::after{background:var(--tbg-brazil-yellow)!important}'));
  assert.ok(css.includes('.tbg-profile-metric{background:rgba(255,255,255,.07)!important'));
});

test('Pink Final link remains intentionally pink as external product branding', () => {
  assert.ok(css.includes('.tbg-pink-final-link{background:#e8a9bc!important'));
  assert.ok(css.includes('Intentional TPF pink'));
});
