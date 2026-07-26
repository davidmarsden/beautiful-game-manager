import test from 'node:test';
import assert from 'node:assert/strict';
import { calculatePerformanceRatings } from '../src/matchEngine/modules/PerformanceRatings.js';

function contextFixture() {
  const players = new Map([
    ['home-gk', { position: 'Goalkeeper' }],
    ['home-sub-gk', { position: 'Goalkeeper' }],
    ['home-st', { position: 'Centre-Forward' }],
    ['home-sub', { position: 'Central Midfield' }],
    ['away-gk', { position: 'Goalkeeper' }],
    ['away-cb', { position: 'Centre-Back' }],
    ['away-st', { position: 'Centre-Forward' }]
  ]);
  const quality = {
    home: {
      team_strength: 84,
      starters: [
        { player_id: 'home-gk', required_role: 'gk', effective_quality: 82 },
        { player_id: 'home-st', required_role: 'st', effective_quality: 88 }
      ],
      bench: { players: [
        { player_id: 'home-sub', effective_quality: 79 },
        { player_id: 'home-sub-gk', required_role: 'gk', effective_quality: 78 }
      ] }
    },
    away: {
      team_strength: 86,
      starters: [
        { player_id: 'away-gk', required_role: 'gk', effective_quality: 87 },
        { player_id: 'away-cb', required_role: 'cb', effective_quality: 85 },
        { player_id: 'away-st', required_role: 'st', effective_quality: 89 }
      ],
      bench: { players: [] }
    }
  };
  const resolution = {
    resolution_complete: true,
    result: 'home_win',
    official_event_stream: [
      { event_id: 'e1', minute: 12, side: 'away', type: 'shot', player_id: 'away-st', on_target: true, outcome: 'saved' },
      { event_id: 'e2', minute: 30, side: 'home', type: 'goal', subtype: null, player_id: 'home-st', assist_player_id: 'home-sub', outcome: 'goal' },
      { event_id: 'e3', minute: 61, side: 'away', type: 'foul', subtype: 'penalty_foul', player_id: 'away-cb' },
      { event_id: 'e4', minute: 62, side: 'home', type: 'penalty', subtype: 'penalty_attempt', player_id: 'home-st', outcome: 'saved' },
      { event_id: 'e5', minute: 80, side: 'away', type: 'red_card', player_id: 'away-cb' }
    ],
    lineup_state: {
      home: { minutes_played: [{ player_id: 'home-gk', minutes: 90 }, { player_id: 'home-st', minutes: 90 }, { player_id: 'home-sub', minutes: 8 }] },
      away: { minutes_played: [{ player_id: 'away-gk', minutes: 90 }, { player_id: 'away-cb', minutes: 90 }, { player_id: 'away-st', minutes: 90 }] }
    }
  };
  return {
    playersById: players,
    get(key) {
      if (key === 'module_b_player_quality') return quality;
      if (key === 'module_e_match_resolution') return resolution;
      return null;
    }
  };
}

test('ratings reward realised contribution rather than reputation alone', () => {
  const ratings = calculatePerformanceRatings(contextFixture());
  const homeStriker = ratings.home.find((row) => row.player_id === 'home-st');
  const sentOffDefender = ratings.away.find((row) => row.player_id === 'away-cb');
  assert.ok(homeStriker.rating > 6);
  assert.ok(sentOffDefender.rating < 5);
  assert.equal(homeStriker.components.baseline, 6);
  assert.ok(homeStriker.components.event_impact > 0);
  assert.ok(sentOffDefender.components.discipline <= -1.25);
});

test('short uneventful cameos remain unrated', () => {
  const ratings = calculatePerformanceRatings(contextFixture());
  const cameo = ratings.home.find((row) => row.player_id === 'home-sub');
  assert.notEqual(cameo.rating, null, 'assist is a meaningful event and should make the cameo rateable');

  const context = contextFixture();
  context.get('module_e_match_resolution').official_event_stream[1].assist_player_id = null;
  const withoutAssist = calculatePerformanceRatings(context);
  assert.equal(withoutAssist.home.find((row) => row.player_id === 'home-sub').rating, null);
});

test('a short cameo penalty foul remains rateable', () => {
  const context = contextFixture();
  const resolution = context.get('module_e_match_resolution');
  resolution.official_event_stream[1].assist_player_id = null;
  resolution.official_event_stream.push({ event_id: 'e6', minute: 88, side: 'home', type: 'foul', subtype: 'penalty_foul', player_id: 'home-sub' });
  resolution.lineup_state.home.minutes_played.find((row) => row.player_id === 'home-sub').minutes = 5;
  const ratings = calculatePerformanceRatings(context);
  const cameo = ratings.home.find((row) => row.player_id === 'home-sub');
  assert.notEqual(cameo.rating, null);
  assert.ok(cameo.components.discipline <= -0.65);
});

test('second-yellow dismissals receive dismissal discipline and highlight', () => {
  const context = contextFixture();
  const resolution = context.get('module_e_match_resolution');
  resolution.official_event_stream.push(
    { event_id: 'e6', minute: 40, side: 'away', type: 'yellow_card', player_id: 'away-st' },
    { event_id: 'e7', minute: 70, side: 'away', type: 'yellow_card', player_id: 'away-st' }
  );
  const ratings = calculatePerformanceRatings(context);
  const dismissed = ratings.away.find((row) => row.player_id === 'away-st');
  assert.equal(dismissed.components.discipline, -1.25);
  assert.ok(dismissed.highlights.includes('sent off'));
  assert.ok(!dismissed.highlights.includes('booked'));
});

test('goalkeepers receive inferred save credit and all ratings are bounded', () => {
  const ratings = calculatePerformanceRatings(contextFixture());
  const homeKeeper = ratings.home.find((row) => row.player_id === 'home-gk');
  const awayKeeper = ratings.away.find((row) => row.player_id === 'away-gk');
  assert.ok(homeKeeper.highlights.includes('1 save'));
  assert.ok(awayKeeper.highlights.includes('1 penalty saved'));
  for (const row of [...ratings.home, ...ratings.away].filter((entry) => entry.rating !== null)) {
    assert.ok(row.rating >= 1 && row.rating <= 10);
    assert.equal(Number(row.rating.toFixed(1)), row.rating);
  }
  assert.ok(ratings.player_of_the_match);
  assert.equal(ratings.deterministic, true);
});

test('save credit follows the active goalkeeper substitution timeline', () => {
  const context = contextFixture();
  const resolution = context.get('module_e_match_resolution');
  resolution.official_event_stream = [
    { event_id: 'g1', minute: 20, side: 'away', type: 'shot', player_id: 'away-st', on_target: true, outcome: 'saved' },
    { event_id: 'g2', minute: 45, side: 'home', type: 'substitution', player_out_id: 'home-gk', player_in_id: 'home-sub-gk' },
    { event_id: 'g3', minute: 70, side: 'away', type: 'shot', player_id: 'away-st', on_target: true, outcome: 'saved' }
  ];
  resolution.lineup_state.home.minutes_played = [
    { player_id: 'home-gk', minutes: 45 },
    { player_id: 'home-sub-gk', minutes: 45 },
    { player_id: 'home-st', minutes: 90 }
  ];
  const ratings = calculatePerformanceRatings(context);
  const starter = ratings.home.find((row) => row.player_id === 'home-gk');
  const replacement = ratings.home.find((row) => row.player_id === 'home-sub-gk');
  assert.ok(starter.highlights.includes('1 save'));
  assert.ok(replacement.highlights.includes('1 save'));
});
