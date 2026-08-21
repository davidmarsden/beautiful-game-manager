import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { applyPublishedPlayerReleases } from '../src/world/playerDataRelease.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

function worldFixture() {
  return {
    squad_cycle: {
      players: {
        'tbg-tm-00342229': { tbg_player_id: 'tbg-tm-00342229', transfermarkt_id: '342229', display_name: 'Kylian Mbappé', underlying_ability_rating: 99, rating: 99 }
      }
    }
  };
}

const history = {
  releases: [{
    release_id: 'prls_test',
    published_at: '2026-08-21T09:00:15.286Z',
    events: [
      { event_type: 'rating_change', player_id: 'tbg-tm-00342229', transfermarkt_id: '342229', before: 99, after: 97 },
      { event_type: 'new_player', player_id: 'tbg-tm-99999999', after: { tbg_rating: 82 } }
    ]
  }]
};

test('published rating changes update the canonical world ability and are idempotent', () => {
  const world = worldFixture();
  const first = applyPublishedPlayerReleases(world, history);
  assert.equal(first.rating_events_applied, 1);
  assert.equal(first.ignored_events, 1);
  assert.deepEqual(first.releases_applied, ['prls_test']);
  assert.equal(world.squad_cycle.players['tbg-tm-00342229'].underlying_ability_rating, 97);
  assert.equal(world.squad_cycle.players['tbg-tm-00342229'].rating, 97);
  assert.equal(world.squad_cycle.players['tbg-tm-00342229'].tbg_rating, 97);
  assert.deepEqual(world.player_data_releases.applied_release_ids, ['prls_test']);

  const second = applyPublishedPlayerReleases(world, history);
  assert.deepEqual(second.releases_applied, []);
  assert.equal(second.rating_events_applied, 0);
});

test('rating release can resolve an existing world player by Transfermarkt id', () => {
  const world = worldFixture();
  const byTm = structuredClone(history);
  byTm.releases[0].events[0].player_id = 'different-canonical-key';
  const summary = applyPublishedPlayerReleases(world, byTm);
  assert.equal(summary.rating_events_applied, 1);
  assert.equal(world.squad_cycle.players['tbg-tm-00342229'].underlying_ability_rating, 97);
});

test('scheduled settlement uses full release history and checksum-protected atomic RPC', async () => {
  const [settlement, migration, config] = await Promise.all([
    read('netlify/functions/player-release-settlement.mjs'),
    read('supabase/migrations/20260821_player_data_release_settlement.sql'),
    read('netlify.toml')
  ]);
  assert.match(settlement, /player-release-history\.json/);
  assert.match(settlement, /applyPublishedPlayerReleases/);
  assert.match(settlement, /apply_player_data_release_settlement/);
  assert.match(settlement, /p_expected_checksum: before\.save_checksum/);
  assert.match(migration, /and save_checksum = p_expected_checksum/);
  assert.match(migration, /and turn_status = 'open'/);
  assert.match(migration, /world_read_model_cache/);
  assert.match(config, /\[functions\."player-release-settlement"\][\s\S]*schedule = "7 \* \* \* \*"/);
});

test('Player Updates names use the existing internal player profile link contract', async () => {
  const updates = await read('public/player-updates.js');
  assert.match(updates, /class="player-update-name player-link"/);
  assert.match(updates, /data-tbg-player-id=/);
  assert.match(updates, /linkedPlayerName\(event/);
});
