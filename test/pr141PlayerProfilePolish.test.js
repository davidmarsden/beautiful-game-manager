import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('player profile uses the polished modal presentation', async () => {
  const profile = await readFile(new URL('../public/player-profile.js', import.meta.url), 'utf8');
  const css = await readFile(new URL('../public/player-profile.css', import.meta.url), 'utf8');
  const index = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');

  assert.match(index, /player-profile\.css/);
  assert.match(profile, /role', 'dialog'/);
  assert.match(profile, /aria-modal/);
  assert.match(profile, /Current TBG club/);
  assert.match(profile, /View in The Pink Final/);
  assert.match(profile, /toLocaleDateString\('en-GB',[\s\S]*timeZone: 'UTC'/);
  assert.match(profile, /normalized\.includes\('unavailable'\)/);
  assert.match(profile, /const tone = negative \? 'bad' : positive \? 'good'/);
  assert.match(profile, /function moraleState/);
  assert.match(profile, /Very low/);
  assert.match(profile, /<span>TBG<\/span><strong>/);
  assert.match(profile, /class="tbg-profile-close"[\s\S]*>×<\/button>/);
  assert.match(profile, /event\.key === 'Escape'/);
  assert.match(profile, /aria-selected/);
  assert.match(css, /position:fixed/);
  assert.match(css, /tbg-player-rating span/);
  assert.match(css, /tbg-profile-close\{position:absolute/);
  assert.match(css, /tbg-pink-final-link\{[\s\S]*padding:12px 14px/);
  assert.match(css, /tbg-profile-grid/);
  assert.match(css, /@media\(max-width:760px\)/);
});
