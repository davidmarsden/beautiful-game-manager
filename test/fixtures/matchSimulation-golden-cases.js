const positions = [
  'Goalkeeper',
  'Right-Back',
  'Centre-Back',
  'Centre-Back',
  'Left-Back',
  'Defensive Midfield',
  'Central Midfield',
  'Attacking Midfield',
  'Right Winger',
  'Centre-Forward',
  'Left Winger'
];

function buildPlayers(prefix, baseRating) {
  return positions.map((position, index) => ({
    tbg_player_id: `${prefix}${index + 1}`,
    display_name: `${prefix.toUpperCase()} Player ${index + 1}`,
    underlying_ability_rating: baseRating + (index % 4) - 1,
    position
  }));
}

export const goldenWorld = {
  world_id: 'golden-world',
  active_season_id: 'golden-season',
  players: [
    ...buildPlayers('h', 90),
    ...buildPlayers('a', 90)
  ]
};

const homeXi = goldenWorld.players.slice(0, 11).map((player) => player.tbg_player_id);
const awayXi = goldenWorld.players.slice(11).map((player) => player.tbg_player_id);

function goldenCase(id, homeTactics, awayTactics) {
  return {
    id,
    contract: {
      contract_version: '2d2-v1',
      run_key: `golden:${id}`,
      fixture: {
        fixture_id: id,
        world_id: goldenWorld.world_id,
        season_id: goldenWorld.active_season_id,
        competition_id: 'golden-division',
        matchday: 1,
        kickoff_at: '2026-07-18T15:00:00.000Z',
        home_club_id: 'golden-home',
        away_club_id: 'golden-away'
      },
      teams: {
        home: {
          side: 'home',
          club_id: 'golden-home',
          formation: '4-3-3-wide',
          starting_xi: homeXi,
          bench: [],
          tactics: homeTactics
        },
        away: {
          side: 'away',
          club_id: 'golden-away',
          formation: '4-3-3-wide',
          starting_xi: awayXi,
          bench: [],
          tactics: awayTactics
        }
      }
    }
  };
}

export const goldenCases = [
  goldenCase(
    'balanced-peers',
    { mentality: 'balanced', pressing: 'mid', tempo: 'normal' },
    { mentality: 'balanced', pressing: 'mid', tempo: 'normal' }
  ),
  goldenCase(
    'home-attacking-edge',
    { mentality: 'attacking', pressing: 'high', tempo: 'fast' },
    { mentality: 'cautious', pressing: 'low', tempo: 'slow' }
  ),
  goldenCase(
    'away-positive-edge',
    { mentality: 'defensive', pressing: 'low', tempo: 'slow' },
    { mentality: 'positive', pressing: 'high', tempo: 'fast' }
  )
];
