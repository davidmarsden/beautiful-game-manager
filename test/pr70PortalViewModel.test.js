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
  assert.equal(first.summary.progress_percent, 50);
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

test('excludes youth and loaned-out players from playable senior depth', () => {
  const data = bootstrap();
  data.squad.push(
    { tbg_player_id: 'academy-cb', display_name: 'Academy Defender', position: 'CB', squad_registration: 'youth', registered: true, injury_status: 'Available' },
    { tbg_player_id: 'loan-cb', display_name: 'Loaned Defender', position: 'CB', loaned_out: true, registered: true, injury_status: 'Available' }
  );
  data.squad = data.squad.filter((player) => !['cb-4', 'cb-5'].includes(player.tbg_player_id));

  const model = buildPortalViewModel(data);
  assert.equal(model.summary.registered, 14);
  assert.equal(model.coverage.find((row) => row.group === 'defender').registered, 4);
  assert.equal(model.coverage.find((row) => row.group === 'defender').gap, 2);
});

test('uses fixture history only for played count and explicit season total for progress', () => {
  const data = bootstrap({
    fixtures: undefined,
    fixture_history: Array.from({ length: 10 }, (_, index) => ({ fixture_id: `played-${index + 1}`, status: 'played', score: { home: 1, away: 0 } })),
    season: { fixture_count: 38 }
  });

  const model = buildPortalViewModel(data);
  assert.equal(model.summary.played, 10);
  assert.equal(model.summary.total, 38);
  assert.equal(model.summary.progress_percent, 26);
});

test('does not claim complete season progress when only capped history is available', () => {
  const data = bootstrap({
    fixtures: undefined,
    fixture_history: Array.from({ length: 10 }, (_, index) => ({ fixture_id: `played-${index + 1}`, status: 'played', score: { home: 1, away: 0 } }))
  });

  const model = buildPortalViewModel(data);
  assert.equal(model.summary.played, 10);
  assert.equal(model.summary.total, 0);
  assert.equal(model.summary.progress_percent, 0);
});
