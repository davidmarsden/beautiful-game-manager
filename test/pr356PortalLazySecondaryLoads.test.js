import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = (name) => readFile(new URL(`../public/${name}`, import.meta.url), 'utf8');

test('hidden portal views do not issue their secondary requests after dashboard bootstrap', async () => {
  const [world, bulk, ratings, negotiations, history, register, followup] = await Promise.all([
    source('world-controls.js'),
    source('bulk-squad-registration.js'),
    source('rating-history-enhancements.js'),
    source('transfer-negotiations.js'),
    source('transfer-history.js'),
    source('world-transfer-register.js'),
    source('portal-followup.js')
  ]);

  assert.match(world, /tbg:view-changed[\s\S]*view === 'world'[\s\S]*loadSharedState/);
  assert.doesNotMatch(world, /tbg:portal-rendered'[\s\S]{0,300}await api\(\)/);
  assert.match(bulk, /tbg:view-changed[\s\S]*view === 'world'[\s\S]*loadBulkRegistration/);
  assert.match(ratings, /tbg:view-changed[\s\S]*view === 'squad'[\s\S]*refresh/);
  assert.doesNotMatch(ratings, /if \(!document\.getElementById\('portal'\)\?\.hidden\) refresh\(\)/);
  assert.match(negotiations, /tbg:portal-rendered'[\s\S]*transfersView[\s\S]*refresh/);
  assert.match(history, /tbg:portal-rendered'[\s\S]*transfersView[\s\S]*scheduleHistoryMount/);
  assert.match(register, /tbg:portal-rendered'[\s\S]*transfersView[\s\S]*schedule/);

  const renderedHandler = followup.match(/window\.addEventListener\('tbg:portal-rendered',[\s\S]*?\n\}\);/)?.[0] || '';
  assert.doesNotMatch(renderedHandler, /refreshLiveTransferPresentation/);
});

test('bulk registration reads the compact manager fragment instead of the full canonical save', async () => {
  const endpoint = await readFile(new URL('../netlify/functions/bulk-squad-registration.mjs', import.meta.url), 'utf8');
  assert.match(endpoint, /rpc\/get_manager_portal_world_fragment/);
  assert.doesNotMatch(endpoint, /canonical_world_saves/);
  assert.doesNotMatch(endpoint, /select=\*/);
  assert.doesNotMatch(endpoint, /loadPersistentWorld/);
});
