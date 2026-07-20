import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareHumanManagerSeason, playHumanManagerSeason } from '../src/matchEngine/humanManagerSeason.js';
import { syntheticSeasonClubs } from '../src/matchEngine/seasonSimulation.js';

const clubs = syntheticSeasonClubs({ clubCount: 6, baseRating: 88 });
const humanClubId = clubs[0].club_id;

test('prepares a complete human-manager dashboard for one season', () => {
  const prepared = prepareHumanManagerSeason({ clubs, humanClubId, seasonId: 'pr64-season' });
  assert.equal(prepared.human_club.club_id, humanClubId);
  assert.equal(prepared.squad.length, 19);
  assert.equal(prepared.schedule.length, 10);
  assert.equal(prepared.required_decisions, 10);
  assert.ok(prepared.schedule.every((fixture) => fixture.opponent_club_id !== humanClubId));
});

test('human manager controls tactics for every fixture and completes the season', () => {
  const report = playHumanManagerSeason({
    clubs,
    humanClubId,
    seasonId: 'pr64-season',
    defaultInstruction: {
      formation: '4-3-3-wide',
      tactics: { style: 'possession', route_to_goal: 'wide', pressing: 'mid', tempo: 'normal', mentality: 'balanced' }
    },
    instructionsByMatchday: {
      1: { tactics: { mentality: 'positive', pressing: 'high' } },
      6: { formation: '4-2-3-1', tactics: { mentality: 'cautious', tempo: 'slow' } }
    }
  });

  assert.equal(report.accepted, true, JSON.stringify(report.checks, null, 2));
  assert.equal(report.decisions.length, 10);
  assert.equal(report.results.length, 10);
  assert.ok(report.decisions.every((decision) => decision.starting_xi.length === 11));
  assert.equal(report.decisions.find((decision) => decision.matchday === 1).tactics.mentality, 'positive');
  assert.equal(report.decisions.find((decision) => decision.matchday === 6).formation, '4-2-3-1');
  assert.equal(report.final_standing.played, 10);
});

test('human manager may select an exact XI from the available matchday squad', () => {
  const exactXi = clubs[0].players.slice(0, 11).map((player) => player.tbg_player_id);
  const report = playHumanManagerSeason({
    clubs,
    humanClubId,
    seasonId: 'pr64-exact-xi',
    defaultInstruction: { starting_xi: exactXi }
  });
  assert.equal(report.accepted, true);
  assert.deepEqual(report.decisions[0].starting_xi, exactXi);
});

test('rejects invalid human lineups before resolving a match', () => {
  assert.throws(() => playHumanManagerSeason({
    clubs,
    humanClubId,
    defaultInstruction: { starting_xi: Array(11).fill(clubs[0].players[0].tbg_player_id) }
  }), /eleven unique player IDs/);
});
