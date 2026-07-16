const text = (value) => String(value ?? '').trim();

export function loadFixtureSubmissions(fixture, submissions) {
  if (!fixture) throw new Error('Fixture is required');
  const byClub = new Map((submissions || []).map((row) => [text(row.club_id), row]));
  const home = byClub.get(text(fixture.home_club_id));
  const away = byClub.get(text(fixture.away_club_id));

  if (!home || !away) {
    const missing = [
      !home ? fixture.home_club_id : null,
      !away ? fixture.away_club_id : null
    ].filter(Boolean);
    throw new Error(`Locked submission missing for club${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`);
  }

  for (const submission of [home, away]) {
    if (submission.status !== 'locked') {
      throw new Error(`Submission ${submission.id || submission.club_id} is not locked`);
    }
    if (!Array.isArray(submission.starting_xi) || submission.starting_xi.length !== 11) {
      throw new Error(`Submission for ${submission.club_id} does not contain exactly 11 starters`);
    }
    if (!Array.isArray(submission.bench)) {
      throw new Error(`Submission for ${submission.club_id} has an invalid bench`);
    }
  }

  return { home, away };
}

function teamContract(side, clubId, submission) {
  return {
    side,
    club_id: clubId,
    submission_id: submission.id,
    submission_version: submission.version,
    submission_source: submission.submission_source || 'manager',
    manager_id: submission.manager_id || null,
    formation: submission.formation,
    starting_xi: submission.starting_xi,
    bench: submission.bench,
    captain_id: submission.captain_id || null,
    set_piece_takers: submission.set_piece_takers || {},
    tactics: submission.tactics || {}
  };
}

export function buildEngineMatchContract({ fixture, submissions, world }) {
  const { home, away } = loadFixtureSubmissions(fixture, submissions);
  const worldId = text(fixture.world_id || world?.world_id);
  if (!worldId) throw new Error('Fixture/world does not provide a world_id');

  return {
    contract_version: '2d1-v1',
    run_key: `${worldId}:${fixture.id}`,
    fixture: {
      fixture_id: fixture.id,
      world_id: worldId,
      season_id: fixture.season_id || world?.active_season_id || null,
      competition_id: fixture.competition_id || null,
      matchday: fixture.matchday ?? null,
      kickoff_at: fixture.kickoff_at,
      home_club_id: fixture.home_club_id,
      away_club_id: fixture.away_club_id
    },
    teams: {
      home: teamContract('home', fixture.home_club_id, home),
      away: teamContract('away', fixture.away_club_id, away)
    },
    world_snapshot: {
      world_id: world?.world_id || worldId,
      season_id: world?.active_season_id || fixture.season_id || null,
      build_id: world?.build_id || world?.generated_at || null,
      source: 'tbg-world-json'
    },
    requested_at: new Date().toISOString()
  };
}
