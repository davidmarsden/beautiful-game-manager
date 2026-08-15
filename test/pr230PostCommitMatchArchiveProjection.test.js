import test from 'node:test';
import assert from 'node:assert/strict';
import { archiveRowsForCanonicalWorld } from '../netlify/functions/refresh-match-archives.mjs';

test('post-commit archive projection reads only the bounded live result window', () => {
  const row = {
    world_id: 'world-1',
    season_id: 'season-1',
    matchday: 8,
    save_checksum: 'checksum-8',
    save_envelope: {
      world: {
        club_profiles: {
          home: { club_name: 'Home' },
          away: { club_name: 'Away' }
        },
        squad_cycle: {
          clubs: {
            home: { player_ids: ['p1'] },
            away: { player_ids: ['p2'] }
          },
          players: {
            p1: { display_name: 'One' },
            p2: { display_name: 'Two' }
          }
        },
        matchday_cycle: {
          season_id: 'season-1',
          runtimes: {
            d1: {
              archive_results: [{ fixture: { fixture_id: 'old', matchday: 6 } }],
              results: [{
                fixture: { fixture_id: 'current', matchday: 7, home_club_id: 'home', away_club_id: 'away', kickoff_at: '2026-08-15T20:00:00Z' },
                score: { home: 2, away: 1 },
                events: [{ event_type: 'goal', side: 'home' }]
              }]
            }
          }
        }
      }
    }
  };

  const rows = archiveRowsForCanonicalWorld(row);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].fixture_id, 'current');
  assert.equal(rows[0].source_checksum, 'checksum-8');
  assert.equal(rows[0].archive_payload.result.score.home, 2);
  assert.deepEqual(Object.keys(rows[0].archive_payload.players).sort(), ['p1', 'p2']);
});