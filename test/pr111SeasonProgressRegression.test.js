import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPortalViewModel } from '../public/portal-v1-model.js';

test('scheduled fixtures with null score fields are not counted as played', () => {
  const fixtures = Array.from({ length: 38 }, (_, index) => ({
    fixture_id: `fixture-${index + 1}`,
    status: index === 0 ? 'played' : 'scheduled',
    home_score: index === 0 ? 2 : null,
    away_score: index === 0 ? 0 : null
  }));

  const model = buildPortalViewModel({
    fixtures,
    fixture_history: [fixtures[0]],
    club: { club_id: 'real-madrid' },
    competition: { standings: [] },
    squad: []
  });

  assert.equal(model.summary.played, 1);
  assert.equal(model.summary.total, 38);
  assert.equal(model.summary.progress_percent, 3);
});
