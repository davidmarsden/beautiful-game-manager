import test from 'node:test';
import assert from 'node:assert/strict';
import { makeManagerDecision } from '../src/matchEngine/managerDecision.js';
import { availabilityForPlayer, createSquadAvailability } from '../src/matchEngine/squadAvailability.js';

function player(id, position, rating, fitness = 100) {
  return {
    tbg_player_id: id,
    position,
    underlying_ability_rating: rating,
    state: { fitness, sharpness: 100 }
  };
}

function squad() {
  return [
    player('gk1', 'Goalkeeper', 90), player('gk2', 'Goalkeeper', 84),
    player('d1', 'Right-Back', 89), player('d2', 'Centre-Back', 91), player('d3', 'Centre-Back', 90), player('d4', 'Left-Back', 88), player('d5', 'Centre-Back', 86),
    player('m1', 'Defensive Midfield', 91), player('m2', 'Central Midfield', 90), player('m3', 'Central Midfield', 89), player('m4', 'Attacking Midfield', 87), player('m5', 'Central Midfield', 85),
    player('a1', 'Right Winger', 92), player('a2', 'Centre-Forward', 93), player('a3', 'Left Winger', 91), player('a4', 'Centre-Forward', 87), player('a5', 'Right Winger', 86),
    player('d6', 'Centre-Back', 84)
  ];
}

function stateFor(players, overrides = {}) {
  return Object.fromEntries(players.map((row) => [row.tbg_player_id, {
    fitness: overrides[row.tbg_player_id] ?? row.state.fitness,
    sharpness: 100
  }]));
}

const club = {
  club_id: 'club-a',
  formation: '4-3-3-wide',
  tactics: { style: 'possession', pressing: 'high', tempo: 'fast', mentality: 'balanced' },
  players: squad()
};

test('manager selects a positionally valid deterministic XI and bench', () => {
  const options = { club, playerState: stateFor(club.players), opponent: { average_rating: 89 }, side: 'home', matchday: 4 };
  const first = makeManagerDecision(options);
  const second = makeManagerDecision(options);

  assert.deepEqual(first, second);
  assert.equal(first.formation, '4-3-3-wide');
  assert.equal(first.starting_xi.length, 11);
  assert.equal(new Set(first.starting_xi).size, 11);
  assert.ok(first.starting_xi.includes('gk1'));
  assert.ok(first.starting_xi.includes('m1'));
  assert.equal(first.bench.length, 7);
  assert.ok(first.starting_xi.every((id) => !first.bench.includes(id)));
  assert.equal(first.decision.emergency_youth_count, 0);
});

test('manager rotates a tired incumbent when the best credible replacement is available', () => {
  const previous = ['gk1', 'd1', 'd2', 'd3', 'd4', 'm1', 'm2', 'm3', 'a1', 'a2', 'a3'];
  const decision = makeManagerDecision({
    club,
    playerState: stateFor(club.players, { a1: 55 }),
    previousStartingXi: previous,
    opponent: { average_rating: 89 },
    matchday: 5
  });

  assert.ok(!decision.starting_xi.includes('a1'));
  assert.ok(decision.starting_xi.includes('a4'));
  assert.ok(decision.decision.rotated_out.includes('a1'));
  assert.ok(decision.decision.rotation_count >= 1);
});

test('manager adapts tactics to opponent strength and squad fitness', () => {
  const strongOpponent = makeManagerDecision({
    club,
    playerState: stateFor(club.players),
    opponent: { average_rating: 96 },
    matchday: 2
  });
  assert.equal(strongOpponent.tactics.mentality, 'cautious');

  const tired = makeManagerDecision({
    club,
    playerState: stateFor(club.players, Object.fromEntries(club.players.map((row) => [row.tbg_player_id, 72]))),
    opponent: { average_rating: 89 },
    matchday: 8
  });
  assert.equal(tired.tactics.pressing, 'low');
  assert.equal(tired.tactics.tempo, 'slow');
});

test('manager respects boolean and availability-object callbacks', () => {
  const unavailable = new Set(['a1']);
  const booleanDecision = makeManagerDecision({
    club,
    playerState: stateFor(club.players),
    availability: (id) => !unavailable.has(id),
    matchday: 3
  });
  assert.ok(!booleanDecision.starting_xi.includes('a1'));
  assert.ok(!booleanDecision.bench.includes('a1'));

  const calendar = createSquadAvailability(club.players.map((row) => row.tbg_player_id));
  calendar.players.a1.injury_until_matchday = 4;
  const objectDecision = makeManagerDecision({
    club,
    playerState: stateFor(club.players),
    availability: (id, matchday) => availabilityForPlayer(calendar, id, matchday),
    matchday: 3
  });
  assert.ok(!objectDecision.starting_xi.includes('a1'));
  assert.ok(!objectDecision.bench.includes('a1'));
});

test('senior players cover out of position before an emergency youth is called', () => {
  const shortDefence = {
    ...club,
    players: club.players.filter((row) => row.tbg_player_id !== 'd4' && row.tbg_player_id !== 'd5' && row.tbg_player_id !== 'd6')
  };
  const decision = makeManagerDecision({
    club: shortDefence,
    playerState: stateFor(shortDefence.players),
    matchday: 3
  });
  assert.equal(decision.starting_xi.length, 11);
  assert.equal(decision.decision.emergency_youth_count, 0);
  assert.ok(decision.decision.out_of_position_count > 0);
});

test('manager promotes deterministic emergency youth when fewer than eleven seniors are eligible', () => {
  const eligibleIds = ['gk1', 'd1', 'd2', 'd3', 'd4', 'm1', 'm2', 'm3', 'a1', 'a2'];
  const options = {
    club,
    playerState: stateFor(club.players),
    availability: (id) => eligibleIds.includes(id),
    matchday: 3
  };
  const first = makeManagerDecision(options);
  const second = makeManagerDecision(options);

  assert.deepEqual(first, second);
  assert.equal(first.starting_xi.length, 11);
  assert.equal(first.decision.eligible_count, 10);
  assert.equal(first.decision.emergency_youth_count, 1);
  assert.ok(first.decision.emergency_youth[0].includes('emergency-youth'));
  assert.ok(first.starting_xi.includes(first.decision.emergency_youth[0]));
});

test('manager supplies an emergency goalkeeper rather than failing', () => {
  const decision = makeManagerDecision({
    club,
    playerState: stateFor(club.players),
    availability: (id) => !id.startsWith('gk'),
    matchday: 7
  });
  assert.equal(decision.starting_xi.length, 11);
  assert.equal(decision.decision.emergency_youth_count, 1);
  assert.ok(decision.decision.emergency_youth[0].includes('goalkeeper'));
});
