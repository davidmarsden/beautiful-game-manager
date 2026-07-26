import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('bulk registration preserves the legacy select used by shared-world rendering', () => {
  const bulkRegistration = fs.readFileSync(new URL('../public/bulk-squad-registration.js', import.meta.url), 'utf8');
  const worldControls = fs.readFileSync(new URL('../public/world-controls.js', import.meta.url), 'utf8');

  assert.match(worldControls, /\$\('registrationPlayer'\)\.innerHTML = options/);
  assert.match(bulkRegistration, /<select id="registrationPlayer" hidden aria-hidden="true" tabindex="-1"><\/select>/);
  assert.match(bulkRegistration, /card\.innerHTML =/);
});
