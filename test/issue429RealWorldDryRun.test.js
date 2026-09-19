import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const script = fs.readFileSync(new URL('../scripts/dry-run-alpha-simulation-managers.mjs', import.meta.url), 'utf8');
const workflow = fs.readFileSync(new URL('../.github/workflows/alpha-simulation-dry-run.yml', import.meta.url), 'utf8');

test('issue #429 real-world dry run is structurally read-only', () => {
  assert.match(script, /async function read\\(path\\)/);
  assert.match(script, /fetch\\(`\\$\\{SUPABASE_URL\\}\\$\\{path\\}`, \\{ headers: serviceHeaders\\(\\) \\}\\)/);
  assert.doesNotMatch(script, /method:\\s*['\"](?:POST|PATCH|PUT|DELETE)['\"]/i);
  assert.doesNotMatch(script, /replace_canonical_world_checkpoint/);
  assert.equal(script.includes('/rpc/'), false);
  assert.match(script, /read_only: true/);
});

test('issue #429 workflow is manual and uploads the diagnostic report', () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /TBG_DRY_RUN_WORLD_ID:/);
  assert.match(workflow, /dry-run-alpha-simulation-managers\\.mjs/);
  assert.match(workflow, /actions\\/upload-artifact@v4/);
  assert.doesNotMatch(workflow, /schedule:/);
});

test('issue #429 diagnostic compares simulation on and off and protects human control', () => {
  assert.match(script, /simulationEnabled: false/);
  assert.match(script, /simulationEnabled: true/);
  assert.match(script, /no_human_club_simulated/);
  assert.match(script, /human_team_selections_unchanged/);
  assert.match(script, /scores_unchanged_by_control_labelling/);
  assert.match(script, /simulation_sources_match_plan/);
});
