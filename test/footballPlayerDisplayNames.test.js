import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWorldReadModel } from '../src/world/worldReadModel.js';

function worldWithPlayer(player) {
  return {
    world_id: 'test-world',
    display_name: 'Test World',
    season_number: 1,
    club_profiles: {},
    competition: { divisions: [] },
    squad_cycle: {
      season_id: 's1',
      clubs: { club_1: { player_ids: ['p1'] } },
      players: { p1: { tbg_player_id: 'p1', club_id: 'club_1', ...player } },
      contracts: {}
    },
    matchday_cycle: { runtimes: {} }
  };
}

function projectedPlayer(player) {
  return buildWorldReadModel(worldWithPlayer(player)).squad_cycle.players.p1;
}

test('explicit football names outrank legal/canonical names and survive the read model', () => {
  const player = projectedPlayer({
    display_name: 'Edson Arantes do Nascimento',
    known_as: 'Pelé'
  });
  assert.equal(player.display_name, 'Pelé');
  assert.equal(player.player_name, 'Pelé');
  assert.equal(player.known_as, 'Pelé');
  assert.equal(player.canonical_name, 'Edson Arantes do Nascimento');
});

test('Transfermarkt profile slugs provide shorter football names when canonical data has only a long full name', () => {
  const vinicius = projectedPlayer({
    display_name: 'Vinicius José Paixão de Oliveira Júnior',
    source_profile_url: 'https://www.transfermarkt.com/vinicius-junior/profil/spieler/371998'
  });
  const rodrygo = projectedPlayer({
    display_name: 'Rodrygo Silva de Goes',
    source_profile_url: 'https://www.transfermarkt.com/rodrygo/profil/spieler/412363'
  });

  assert.equal(vinicius.display_name, 'Vinicius Jr.');
  assert.equal(rodrygo.display_name, 'Rodrygo');
});

test('profile slug does not replace an equally concise canonical football name', () => {
  const player = projectedPlayer({
    display_name: 'Kylian Mbappé',
    source_profile_url: 'https://www.transfermarkt.com/kylian-mbappe/profil/spieler/342229'
  });
  assert.equal(player.display_name, 'Kylian Mbappé');
});

test('malformed or non-Transfermarkt profile URLs cannot invent player names', () => {
  const player = projectedPlayer({
    display_name: 'Jude Bellingham',
    source_profile_url: 'not a useful source',
    profile_url: 'https://thepinkfinal.online/player/tbg-123'
  });
  assert.equal(player.display_name, 'Jude Bellingham');
});

test('URLs that only mention Transfermarkt outside the hostname are not trusted', () => {
  const player = projectedPlayer({
    display_name: 'Long Canonical Footballer Name',
    source_profile_url: 'https://example.test/short/profil/player/1?source=transfermarkt'
  });
  assert.equal(player.display_name, 'Long Canonical Footballer Name');
});

test('standalone Junior remains a mononym while multi-word Junior becomes Jr.', () => {
  const mononym = projectedPlayer({
    display_name: 'Very Long Legal Player Name',
    source_profile_url: 'https://www.transfermarkt.com/junior/profil/spieler/1'
  });
  const suffix = projectedPlayer({
    display_name: 'Vinicius José Paixão de Oliveira Júnior',
    source_profile_url: 'https://www.transfermarkt.com/vinicius-junior/profil/spieler/371998'
  });

  assert.equal(mononym.display_name, 'Junior');
  assert.equal(suffix.display_name, 'Vinicius Jr.');
});
