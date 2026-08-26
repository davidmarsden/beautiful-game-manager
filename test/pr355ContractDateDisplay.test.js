import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../public/canonical-display.js', import.meta.url), 'utf8');

test('squad contract expiry display strips the ISO time suffix', () => {
  assert.match(source, /function applyContractDateDisplay\(\)/);
  assert.match(source, /#squadRows tr/);
  assert.match(source, /row\.children\?\.\[8\]/);
  assert.match(source, /\^\(\\d\{4\}-\\d\{2\}-\\d\{2\}\)T/);
  assert.match(source, /contractCell\.textContent = match\[1\]/);
});

test('canonical display reapplies contract date formatting after portal render', () => {
  assert.match(source, /applyContractDateDisplay\(\);/);
  assert.match(source, /tbg:portal-rendered/);
});

test('squad filter search and sort rerenders reapply date formatting without an observer', () => {
  assert.match(source, /function bindContractDateInteractions\(\)/);
  assert.match(source, /registrationFilter/);
  assert.match(source, /squadSearch/);
  assert.match(source, /positionFilter/);
  assert.match(source, /availabilityFilter/);
  assert.match(source, /#squadTable th\[data-sort\]/);
  assert.match(source, /window\.setTimeout\(applyContractDateDisplay, 0\)/);
  assert.doesNotMatch(source, /MutationObserver/);
});
