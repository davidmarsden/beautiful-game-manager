import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { decorateMatchCentrePayload } from '../netlify/functions/match-centre-linked.mjs';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('match centre payload projects stable Pink Final identity by player ID', () => {
  const world = {
    squad_cycle: {
      players: {
        'tbg-player-001': { tbg_player_id: 'tbg-player-001', display_name: 'Published Player' },
        'academy-intake-001': { tbg_player_id: 'academy-intake-001', display_name: 'Generated Youth', generated: true, source: 'youth_intake' }
      }
    }
  };
  const payload = decorateMatchCentrePayload({
    fixture: { world_id: 'world-1', home_club_id: 'home', away_club_id: 'away' },
    events: [{ player_id: 'tbg-player-001', player_name: 'Published Player' }],
    submissions: [{ club_id: 'home', starting_xi: [{ id: 'tbg-player-001', name: 'Published Player' }], bench: [{ id: 'academy-intake-001', name: 'Generated Youth' }] }],
    summary: {
      scorers: { home: [{ player_id: 'tbg-player-001', player_name: 'Published Player' }], away: [] },
      cards: { home: [], away: [] },
      player_of_the_match: { player_id: 'tbg-player-001', player_name: 'Published Player', rating: 8.4 },
      top_ratings: [{ player_id: 'tbg-player-001', player_name: 'Published Player', rating: 8.4 }]
    },
    player_performances: { home: [{ player_id: 'tbg-player-001', player_name: 'Published Player' }], away: [] }
  }, world);

  assert.match(payload.events[0].profile_url, /\?id=tbg-player-001$/);
  assert.match(payload.submissions[0].starting_xi[0].profile_url, /\?id=tbg-player-001$/);
  assert.equal(payload.submissions[0].bench[0].profile_url, null);
  assert.equal(payload.submissions[0].bench[0].pink_final_profile_status, 'unpublished');
  assert.match(payload.summary.player_of_the_match.profile_url, /\?id=tbg-player-001$/);
});

test('browser layer links structured Match Centre player surfaces without display-name URL guessing', async () => {
  const browser = await read('../public/match-centre-player-links.js');
  const index = await read('../public/index.html');

  assert.match(browser, /match-centre-linked/);
  assert.match(browser, /player\.profile_url/);
  assert.match(browser, /decorateLineups/);
  assert.match(browser, /decorateSummary/);
  assert.match(browser, /decorateEvents/);
  assert.doesNotMatch(browser, /slugify|display_name.*replace|player_name.*replace/);
  assert.match(index, /match-centre-player-links\.js/);
  assert.match(index, /match-centre-player-links\.css/);
});
