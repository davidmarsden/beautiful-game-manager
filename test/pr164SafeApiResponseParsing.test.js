import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('safe response diagnostics load before portal and world modules', async () => {
  const html = await read('public/index.html');
  const safeIndex = html.indexOf('safe-response-json.js');
  const bootIndex = html.indexOf('portal-boot-recovery.js');
  const moduleIndex = html.indexOf('type="module"');
  assert.ok(safeIndex >= 0, 'safe response diagnostics must be loaded');
  assert.ok(safeIndex < bootIndex, 'safe response diagnostics must be available to boot recovery');
  assert.ok(safeIndex < moduleIndex, 'safe response diagnostics must be available before module fetches');
});

test('empty and invalid API bodies retain HTTP diagnostics instead of leaking JSON parser errors', async () => {
  const source = await read('public/safe-response-json.js');
  assert.match(source, /const nativeJson = Response\.prototype\.json/);
  assert.match(source, /const diagnosticCopy = this\.clone\(\)/);
  assert.match(source, /empty response body/);
  assert.match(source, /invalid JSON response/);
  assert.match(source, /diagnosticCopy\.status/);
  assert.match(source, /diagnosticCopy\.headers\.get\('content-type'\)/);
  assert.match(source, /slice\(0, 500\)/);
  assert.doesNotMatch(source, /Unexpected end of JSON input/);
});
