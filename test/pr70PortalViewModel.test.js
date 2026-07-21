import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPortalViewModel, positionGroup } from '../public/portal-v1-model.js';

function bootstrap(overrides = {}) {
  return {
    club: { tbg_club_id: 'club-1', canonical_name: 'Club One', table_position: 4 },
    next_fixture: { opponent_name: 'Club Two', submission_deadline_at: '2026-08-08T12:00:00.000Z' },
    standings: [{ club_id: 'club-1', position: 4, points: 7 }],
    fixtures: [
      { fixture_id: 'f1', completed: true, score: { home: 2, away: 1 } },
      { fixture_id: 'f2', status: 'scheduled' }
    ],
    squad: [
      { tbg_player_id: 'gk-1', display_name: 'Keeper One', position: 'GK', registered: true, injury_status: 'Available', contract_expiry: '2027-01-01' },
      { tbg_player_id: 'gk-2', display_name: 'Keeper Two', position: 'GK', registered: true, injury_status: 'Injured' },
      ...Array.from({ length: 6 }, (_, index) => ({ tbg_player_id: `cb-${index}`, display_name: `Defender ${index}`, position: index % 2 ? 'CB' : 'RB', registered: true, injury_status: 'Available' })),
      ...Array.from({ length: 5 }, (_, index) => ({ tbg_player_id: `cm-${index}`, display_name: `Midfielder ${index}`, position: index ? 'CM' : 'DM', registered: true, injury_status: 'Available' })),
      ...Array.from({ length: 3 }, (_, index) => ({ tbg_player_id: `cf-${index}`, display_name: `Forward ${index}`, position: index ? 'CF' : 'RW', registered: true, injury_status: 'Available' }))
    ],
    ...overrides
  };
}

test('maps canonical TM and legacy position values to planning groups', () => {
  assert.equal(positionGroup('GK'), 'goalkeeper');
  assert.equal(positionGroup('CB'), 'defender');
  assert.equal(positionGroup('DM'), 'midfielder');
  assert.equal(positionGroup('RW'), 'attacker');
  assert.equal(positionGroup('DEF'), 'defender');
  assert.equal(positionGroup('MID'), 'midfielder');
  assert.equal(positionGroup('ATT'), 'attacker');
});

test('builds a deterministic tablet overview from bootstrap data', () => {
  const data = bootstrap();
  const first = buildPortalViewModel(data, { now: new Date('2026-08-01T00:00:00.000Z') });
  const second = buildPortalViewModel(data, { now: new Date('2026-08-01T00:00:00.000Z') });

  assert.deepEqual(first, second);
  assert.equal(first.summary.table_position, 4);
  assert.equal(first.summary.played, 1);
  assert.equal(first.summary.total, 2);
  assert.equal(first.summary.progress_known, true);
  assert.equal(first.summary.progress_percent, 50);
  assert.equal(first.summary.has_next_fixture, true);
  assert.equal(first.summary.registered, 16);
  assert.equal(first.coverage.every((row) => row.gap === 0), true);
  assert.ok(first.alerts.some((row) => row.title === 'Team selection not submitted'));
});

test('surfaces structural, temporary and contract alerts without inventing archive awards', () => {
  const data = bootstrap();
  data.squad = data.squad.filter((player) => player.tbg_player_id !== 'cb-5');
  data.season_archive = { awards: { champion: { club_id: 'club-1' }, golden_boot: null, assist_leader: null } };
  const model = buildPortalViewModel(data, { now: new Date('2026-11-01T00:00:00.000Z') });

  assert.equal(model.coverage.find((row) => row.group === 'defender').gap, 1);
  assert.equal(model.coverage.find((row) => row.group === 'goalkeeper').temporary_gap, 1);
  assert.ok(model.contracts.some((row) => row.player_id === 'gk-1'));
  assert.equal(model.archive.champion.club_id, 'club-1');
  assert.equal(model.archive.golden_boot, null);
  assert.equal(model.archive.assist_leader, null);
});

test('excludes youth and loaned players from playable senior depth', () => {
  const data = bootstrap();
  data.squad = data.squad.filter((player) => !['cb-4', 'cb-5'].includes(player.tbg_player_id));
  data.squad.push(
    { tbg_player_id: 'academy-cb', display_name: 'Academy Defender', position: 'CB', squad_registration: 'youth', registered: true, injury_status: 'Available' },
    { tbg_player_id: 'loan-cb', display_name: 'Loaned Defender', position: 'CB', loaned_out: true, registered: true, injury_status: 'Available' }
  );
  const model = buildPortalViewModel(data);
  assert.equal(model.coverage.find((row) => row.group === 'defender').registered, 4);
  assert.equal(model.coverage.find((row) => row.group === 'defender').gap, 2);
  assert.equal(model.summary.registered, 14);
});

test('uses explicit fixture total rather than capped fixture history', () => {
  const data = bootstrap({
    fixtures: undefined,
    fixture_history: Array.from({ length: 10 }, (_, index) => ({ fixture_id: `played-${index}`, completed: true })),
    season: { fixture_count: 38 }
  });
  const model = buildPortalViewModel(data);
  assert.equal(model.summary.played, 10);
  assert.equal(model.summary.total, 38);
  assert.equal(model.summary.progress_known, true);
  assert.equal(model.summary.progress_percent, 26);
});

test('shows played count without inventing a percentage when schedule total is unavailable', () => {
  const data = bootstrap({
    next_fixture: null,
    fixtures: undefined,
    fixture_history: Array.from({ length: 2 }, (_, index) => ({ fixture_id: `played-${index}`, completed: true }))
  });
  data.squad = [
    ...data.squad.map((player) => ({ ...player, injury_status: 'Available' })),
    { tbg_player_id: 'depth-1', display_name: 'Depth Midfielder', position: 'CM', registered: true, injury_status: 'Available' },
    { tbg_player_id: 'depth-2', display_name: 'Depth Forward', position: 'CF', registered: true, injury_status: 'Available' }
  ];
  const model = buildPortalViewModel(data);
  assert.equal(model.summary.played, 2);
  assert.equal(model.summary.total, 0);
  assert.equal(model.summary.progress_known, false);
  assert.equal(model.summary.progress_percent, null);
  assert.equal(model.summary.has_next_fixture, false);
  assert.equal(model.summary.next_opponent, 'Schedule pending');
  assert.equal(model.alerts.some((row) => row.title === 'Team selection not submitted'), false);
  assert.equal(model.alerts.length, 1);
  assert.equal(model.alerts[0].detail, 'No squad decisions require attention');
});
