import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const uiSource = readFileSync(new URL('../public/manager-shortlist.js', import.meta.url), 'utf8');
const apiSource = readFileSync(new URL('../netlify/functions/shortlist.mjs', import.meta.url), 'utf8');
const migrationSource = readFileSync(new URL('../supabase/migrations/20260908_manager_shortlist.sql', import.meta.url), 'utf8');
const loaderSource = readFileSync(new URL('../public/internal-profile-links.js', import.meta.url), 'utf8');

test('manager shortlist is loaded into the portal transfer experience', () => {
  assert.match(loaderSource, /import '\.\/manager-shortlist\.js';/);
  assert.match(uiSource, /dataShortlistTab|dataset\.shortlistTab|data-shortlist-tab/);
  assert.match(uiSource, /data-shortlist-toggle/);
});

test('shortlist API stores only a deliberately whitelisted visible snapshot', () => {
  assert.match(apiSource, /const allowed = \['display_name','position','age','rating','club_name','asking_fee','nationality','market_value_eur','transfermarkt_id','contract_label'\]/);
  assert.doesNotMatch(apiSource, /potential_rating|hidden_rating|scout_rating|wage_demand|agent_demand|personality|development_ceiling/);
});

test('shortlisting never queries canonical player data to enrich the snapshot', () => {
  assert.doesNotMatch(apiSource, /from\(['"]players['"]\)/);
  assert.doesNotMatch(apiSource, /\/rest\/v1\/players/);
  assert.match(uiSource, /Shortlisting is private and reveals nothing new about a player/);
});

test('shortlist persistence is manager-private and service-role mediated', () => {
  assert.match(migrationSource, /alter table public\.manager_shortlist enable row level security;/);
  assert.match(migrationSource, /revoke all on table public\.manager_shortlist from public, anon, authenticated;/);
  assert.match(migrationSource, /grant execute on function public\.get_manager_shortlist_for_user\(uuid,text\) to service_role;/);
  assert.match(migrationSource, /where user_id = p_user_id and status = 'active'/);
});

test('manager notes are private, bounded, and saved independently of recruitment actions', () => {
  assert.match(migrationSource, /length\(p_note\), 0\) > 1000/);
  assert.match(uiSource, /maxlength="1000"/);
  assert.match(uiSource, /Private note/);
  assert.match(uiSource, /Save note/);
});

test('shortlist decoration does not endlessly retrigger its mutation observer', () => {
  assert.match(uiSource, /const glyph = selected \? '★' : '☆';/);
  assert.match(uiSource, /if \(button\.textContent !== glyph\) button\.textContent = glyph;/);
});

test('direct shortlist offer re-queries the live listing after the market tab rerenders', () => {
  assert.match(uiSource, /openMarketTab\('listed'\);\s*setTimeout\(\(\) => \{\s*const offer = \[\.\.\.document\.querySelectorAll\('\[data-open-market-prepare-offer\]'\)\]/s);
  assert.match(uiSource, /if \(offer\) offer\.click\(\);/);
});

test('shortlist load failures render an error and an actionable retry state', () => {
  assert.match(uiSource, /shortlistError = error\.message \|\| 'Could not load your shortlist\.'/);
  assert.match(uiSource, /data-shortlist-retry/);
  assert.match(uiSource, /Try again/);
});
