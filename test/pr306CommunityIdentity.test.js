import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(new URL('../supabase/migrations/20260824c_manager_public_contacts.sql', import.meta.url), 'utf8');
const endpoint = fs.readFileSync(new URL('../netlify/functions/manager-participation.mjs', import.meta.url), 'utf8');
const profile = fs.readFileSync(new URL('../public/manager-participation.js', import.meta.url), 'utf8');
const community = fs.readFileSync(new URL('../public/community-card.js', import.meta.url), 'utf8');
const green = fs.readFileSync(new URL('../public/tbg-green-stock.css', import.meta.url), 'utf8');

test('manager contacts are opt-in and account email is not reused automatically', () => {
  assert.ok(migration.includes('manager_public_contacts'));
  assert.ok(migration.includes('publish_whatsapp boolean not null default false'));
  assert.ok(migration.includes('publish_email boolean not null default false'));
  assert.ok(migration.includes('publish_discord boolean not null default false'));
  assert.ok(endpoint.includes("body.action !== 'save-contact'"));
  assert.ok(endpoint.includes('row.publish_whatsapp ? row.whatsapp'));
  assert.ok(profile.includes('Your sign-in email is never exposed automatically.'));
});

test('explicit self profile IDs still receive private contact values and publish flags', () => {
  assert.ok(endpoint.includes("String(targetId) === String(context.managerId)"));
  assert.ok(endpoint.includes('result?.is_self === true'));
  assert.ok(endpoint.includes('contactFor(targetId, isSelf)'));
});

test('managers can open other managers and see deliberately shared contact details', () => {
  assert.ok(profile.includes("sectionTitle('Managers in this world')"));
  assert.ok(profile.includes("sectionTitle('Contact')"));
  assert.ok(profile.includes('data-manager-profile-id') || profile.includes('dataset.managerProfileId'));
});

test('alpha WhatsApp community is prominent and has direct link plus QR', () => {
  assert.ok(community.includes('https://chat.whatsapp.com/HCUCxUHAkfLEQkUvyu3VsF'));
  assert.ok(community.includes('Join WhatsApp community'));
  assert.ok(community.includes('data:image/png;base64,'));
  assert.ok(community.includes("#feedView .world-feed-shell"));
  assert.ok(profile.includes('communityCard()'));
});

test('community card retries when the async World Feed shell is inserted', () => {
  assert.ok(community.includes("node.matches?.('.world-feed-shell')"));
  assert.ok(community.includes("node.querySelector?.('.world-feed-shell')"));
  assert.ok(community.includes('mountCommunityCard();'));
  assert.ok(community.includes('observer.observe(document.documentElement'));
});

test('TBG gets its own green identity layer while retaining existing layout', () => {
  assert.ok(green.includes('--tbg-colour-paper:#8fae78'));
  assert.ok(green.includes('--tbg-green-deep:#183a28'));
  assert.ok(green.includes('.tabs'));
  assert.ok(community.includes("loadStylesheet('tbg-green-stock.css')"));
});

test('player updates governance copy is simplified for managers', () => {
  assert.ok(community.includes("replace(' Manager does not recalculate these ratings.', '')"));
});
