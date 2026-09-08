import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const guard = readFileSync(new URL('../public/match-centre-runtime-guard.js', import.meta.url), 'utf8');

test('Match Centre contains transport failures instead of throwing into portal recovery', () => {
  assert.match(guard, /try \{[\s\S]*response = await guardedFetch\(input, init\);[\s\S]*\} catch \(error\) \{/);
  assert.match(guard, /if \(!matchCentreRequest\) throw error;/);
  assert.match(guard, /match_centre_fetch_failed/);
  assert.match(guard, /Could not reach the match archive/);
});

test('Match Centre normalizes non-JSON server failures for phase2d4 JSON parsing', () => {
  assert.match(guard, /if \(!response\.ok\)/);
  assert.match(guard, /await response\.clone\(\)\.json\(\)/);
  assert.match(guard, /match_centre_invalid_error_response/);
});

test('Match Centre also contains malformed successful archive responses', () => {
  assert.match(guard, /match_centre_invalid_success_response/);
  assert.match(guard, /unreadable response/);
});
