const text = (value) => String(value ?? '').trim();
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

export const SEASON_ARCHIVE_VERSION = 'tbg-season-archive-v1.2';

function freezeRows(rows) {
  return Object.freeze(rows.map((row) => Object.freeze(row)));
}

function stableRank(rows, valueKeys) {
  return [...rows].sort((a, b) => {
    for (const [key, direction = 'desc'] of valueKeys) {
      const left = number(a[key]);
      const right = number(b[key]);
      if (left !== right) return direction === 'asc' ? left - right : right - left;
    }
    return text(a.player_id || a.club_id).localeCompare(text(b.player_id || b.club_id));
  });
}

function eventType(event) {
  return text(event?.type || event?.event_type || event?.kind).toLowerCase();
}

function goalScorer(event) {
  return text(event?.player_id || event?.scorer_id || event?.scorer?.player_id || event?.actor_player_id);
}

function assistPlayer(event) {
  return text(event?.assist_player_id || event?.assister_id || event?.assist?.player_id);
}

function cardPlayer(event) {
  return text(event?.player_id || event?.booked_player_id || event?.actor_player_id);
}

function playerClubMap(season) {
  const map = new Map();
  for (const result of season.results || []) {
    for (const side of ['home', 'away']) {
      const clubId = result.fixture?.[`${side}_club_id`];
      const team = result.teams?.[side];
      for (const id of [...(team?.starting_xi || []), ...(team?.bench || []), ...(result.lineup_state?.[side]?.players_used || [])]) {
        if (!map.has(id)) map.set(id, clubId);
      }
    }
  }
  return map;
}

function buildPlayerRecords(season) {
  const records = new Map();
  const clubByPlayer = playerClubMap(season);
  const ensure = (id) => {
    if (!id) return null;
    if (!records.has(id)) records.set(id, {
      player_id: id,
      club_id: clubByPlayer.get(id) || null,
      appearances: 0,
      starts: 0,
      bench_appearances: 0,
      goals: 0,
      assists: 0,
      yellow_cards: 0,
      red_cards: 0
    });
    return records.get(id);
  };

  for (const result of season.results || []) {
    for (const side of ['home', 'away']) {
      const team = result.teams?.[side] || {};
      const starters = new Set(team.starting_xi || []);
      const playersUsed = new Set(result.lineup_state?.[side]?.players_used || team.starting_xi || []);
      for (const id of starters) {
        const row = ensure(id);
        row.starts += 1;
      }
      for (const id of playersUsed) {
        const row = ensure(id);
        row.appearances += 1;
      }
      for (const id of team.bench || []) {
        const row = ensure(id);
        row.bench_appearances += 1;
      }
    }

    for (const event of result.events || []) {
      const type = eventType(event);
      if (type.includes('goal') && !type.includes('own_goal')) {
        const scorer = ensure(goalScorer(event));
        if (scorer) scorer.goals += 1;
        const assister = ensure(assistPlayer(event));
        if (assister) assister.assists += 1;
      }
      if (type.includes('yellow')) {
        const player = ensure(cardPlayer(event));
        if (player) player.yellow_cards += 1;
      }
      if (type.includes('red')) {
        const player = ensure(cardPlayer(event));
        if (player) player.red_cards += 1;
      }
    }
  }

  return freezeRows([...records.values()].sort((a, b) => a.player_id.localeCompare(b.player_id)));
}

function buildClubRecords(season) {
  return freezeRows((season.standings || []).map((row) => ({
    position: row.position,
    club_id: row.club_id,
    played: row.played,
    won: row.won,
    drawn: row.drawn,
    lost: row.lost,
    goals_for: row.gf,
    goals_against: row.ga,
    goal_difference: row.gd,
    points: row.points,
    champion: row.position === 1
  })));
}

function rebuildClubRecords(results, clubIds) {
  const table = Object.fromEntries(clubIds.map((clubId) => [clubId, {
    club_id: clubId, played: 0, won: 0, drawn: 0, lost: 0,
    goals_for: 0, goals_against: 0, goal_difference: 0, points: 0
  }]));
  for (const result of results || []) {
    const home = table[text(result.fixture?.home_club_id)];
    const away = table[text(result.fixture?.away_club_id)];
    if (!home || !away) continue;
    const homeGoals = number(result.score?.home);
    const awayGoals = number(result.score?.away);
    home.played += 1; away.played += 1;
    home.goals_for += homeGoals; home.goals_against += awayGoals;
    away.goals_for += awayGoals; away.goals_against += homeGoals;
    if (homeGoals > awayGoals) { home.won += 1; away.lost += 1; home.points += 3; }
    else if (awayGoals > homeGoals) { away.won += 1; home.lost += 1; away.points += 3; }
    else { home.drawn += 1; away.drawn += 1; home.points += 1; away.points += 1; }
  }
  for (const row of Object.values(table)) row.goal_difference = row.goals_for - row.goals_against;
  return table;
}

function buildAwards(clubs, players) {
  const champion = clubs[0] || null;
  const bestAttack = stableRank(clubs, [['goals_for', 'desc'], ['points', 'desc']])[0] || null;
  const bestDefence = stableRank(clubs, [['goals_against', 'asc'], ['points', 'desc']])[0] || null;
  const topScorer = stableRank(players, [['goals', 'desc'], ['assists', 'desc'], ['appearances', 'asc']])[0] || null;
  const assistLeader = stableRank(players, [['assists', 'desc'], ['goals', 'desc'], ['appearances', 'asc']])[0] || null;
  const appearanceLeader = stableRank(players, [['appearances', 'desc'], ['starts', 'desc']])[0] || null;
  return Object.freeze({
    champion: champion ? Object.freeze({ club_id: champion.club_id, position: champion.position, points: champion.points }) : null,
    best_attack: bestAttack ? Object.freeze({ club_id: bestAttack.club_id, goals_for: bestAttack.goals_for }) : null,
    best_defence: bestDefence ? Object.freeze({ club_id: bestDefence.club_id, goals_against: bestDefence.goals_against }) : null,
    golden_boot: topScorer && topScorer.goals > 0 ? Object.freeze({ player_id: topScorer.player_id, club_id: topScorer.club_id, goals: topScorer.goals }) : null,
    assist_leader: assistLeader && assistLeader.assists > 0 ? Object.freeze({ player_id: assistLeader.player_id, club_id: assistLeader.club_id, assists: assistLeader.assists }) : null,
    appearance_leader: appearanceLeader && appearanceLeader.appearances > 0 ? Object.freeze({ player_id: appearanceLeader.player_id, club_id: appearanceLeader.club_id, appearances: appearanceLeader.appearances }) : null
  });
}

function buildRecords(clubs, players) {
  return Object.freeze({
    most_points: stableRank(clubs, [['points', 'desc'], ['goal_difference', 'desc']])[0] || null,
    most_wins: stableRank(clubs, [['won', 'desc'], ['points', 'desc']])[0] || null,
    most_goals: stableRank(clubs, [['goals_for', 'desc'], ['points', 'desc']])[0] || null,
    fewest_goals_conceded: stableRank(clubs, [['goals_against', 'asc'], ['points', 'desc']])[0] || null,
    most_player_appearances: stableRank(players, [['appearances', 'desc'], ['starts', 'desc']])[0] || null,
    most_player_goals: stableRank(players, [['goals', 'desc'], ['assists', 'desc']])[0] || null
  });
}

export function createSeasonArchive(season, { archivedAt = null } = {}) {
  if (!season?.season_id) throw new Error('Season archive requires a season_id');
  if (!Array.isArray(season.standings) || !Array.isArray(season.results)) throw new Error('Season archive requires standings and results');

  const clubs = buildClubRecords(season);
  const players = buildPlayerRecords(season);
  const awards = buildAwards(clubs, players);
  const records = buildRecords(clubs, players);
  const fixtureIds = season.results.map((row) => text(row.fixture?.fixture_id));
  const rebuilt = rebuildClubRecords(season.results, clubs.map((row) => row.club_id));
  const fixturesMatchStandings = clubs.every((row) => {
    const source = rebuilt[row.club_id];
    return source && ['played', 'won', 'drawn', 'lost', 'goals_for', 'goals_against', 'goal_difference', 'points']
      .every((key) => number(row[key]) === number(source[key]));
  });

  const checks = Object.freeze({
    fixture_count_reconciles: fixtureIds.length === number(season.fixture_count, fixtureIds.length),
    fixture_ids_are_unique: new Set(fixtureIds).size === fixtureIds.length && fixtureIds.every(Boolean),
    one_champion: clubs.filter((row) => row.champion).length === 1,
    standings_reconcile: clubs.every((row) => row.played === row.won + row.drawn + row.lost && row.points === row.won * 3 + row.drawn),
    standings_match_fixture_scores: fixturesMatchStandings,
    goals_reconcile: clubs.reduce((sum, row) => sum + row.goals_for, 0) === clubs.reduce((sum, row) => sum + row.goals_against, 0),
    player_starts_reconcile: players.reduce((sum, row) => sum + row.starts, 0) === fixtureIds.length * 22,
    player_appearances_cover_starts: players.every((row) => row.appearances >= row.starts),
    awards_reference_archived_entities: !awards.champion || clubs.some((row) => row.club_id === awards.champion.club_id)
  });

  return Object.freeze({
    version: SEASON_ARCHIVE_VERSION,
    archive_id: `${season.season_id}:archive`,
    season_id: season.season_id,
    archived_at: archivedAt ? new Date(archivedAt).toISOString() : null,
    summary: Object.freeze({ club_count: clubs.length, fixture_count: fixtureIds.length, total_goals: clubs.reduce((sum, row) => sum + row.goals_for, 0), champion_club_id: awards.champion?.club_id || null }),
    clubs, players, awards, records,
    source_fixture_ids: Object.freeze(fixtureIds),
    checks,
    accepted: Object.values(checks).every(Boolean)
  });
}

export function appendSeasonArchive(history, archive) {
  if (!archive?.accepted) throw new Error('Cannot append an unaccepted season archive');
  const archives = [...(history?.archives || [])];
  if (archives.some((row) => row.archive_id === archive.archive_id || row.season_id === archive.season_id)) throw new Error(`Season already archived: ${archive.season_id}`);
  archives.push(archive);
  archives.sort((a, b) => a.season_id.localeCompare(b.season_id));
  return Object.freeze({ version: 'tbg-history-index-v1.0', archives: Object.freeze(archives) });
}
