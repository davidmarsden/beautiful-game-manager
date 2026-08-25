import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('#310 publishes a discoverable controlled-alpha tester guide', () => {
  const guide = read('public/alpha-guide.html');
  const auth = read('public/auth-entry.js');

  assert.match(guide, /What are TBG and TPF\?/);
  assert.match(guide, /try to break it like a tester/i);
  assert.match(guide, /Real life comes first/i);
  assert.match(guide, /reset may still be necessary/i);
  assert.match(guide, /Do not include passwords, magic links, credentials or other secrets/i);
  assert.match(guide, /private account information/i);
  assert.match(guide, /World Feed is the in-world community\/news space/i);
  assert.match(guide, /No cups yet/i);
  assert.match(guide, /loans and three-club deals/i);
  assert.match(auth, /alpha-guide\.html/);
});

test('#310 links styled local Alpha Rulebook and Road Ahead pages from guide and portal', () => {
  const guide = read('public/alpha-guide.html');
  const auth = read('public/auth-entry.js');
  const css = read('public/governance-links.css');
  const rulebook = read('public/rulebook.html');
  const roadAhead = read('public/road-ahead.html');
  const pageCss = read('public/governance-page.css');

  assert.match(guide, /\.\/rulebook\.html/);
  assert.match(guide, /\.\/road-ahead\.html/);
  assert.match(guide, /Alpha Rulebook — current rules/);
  assert.match(guide, /Road Ahead — planned systems/);

  assert.match(auth, /const ALPHA_RULEBOOK_URL = '\.\/rulebook\.html'/);
  assert.match(auth, /const ROAD_AHEAD_URL = '\.\/road-ahead\.html'/);
  assert.match(auth, /Rules &amp; roadmap/);
  assert.match(auth, /Alpha Rulebook — current rules/);
  assert.match(auth, /Road Ahead — planned systems/);
  assert.match(css, /\.tbg-governance-links/);

  assert.match(rulebook, /CURRENT ALPHA RULES/);
  assert.match(rulebook, /80 clubs/);
  assert.match(rulebook, /25 first-team players/);
  assert.match(rulebook, /Promotion and relegation — known alpha gap/);
  assert.match(rulebook, /View the canonical Markdown source on GitHub/);

  assert.match(roadAhead, /PLANNED SYSTEMS/);
  assert.match(roadAhead, /Players make career decisions/);
  assert.match(roadAhead, /Knowledge Regions/);
  assert.match(roadAhead, /Board Confidence/);
  assert.match(roadAhead, /View the canonical Markdown source on GitHub/);
  assert.match(pageCss, /\.governance-hero/);
});

test('#310 provides a valid structured external alpha bug-report form', () => {
  const form = read('.github/ISSUE_TEMPLATE/controlled-alpha-bug.yml');

  assert.match(form, /^name:\s*Controlled alpha bug/m);
  assert.match(form, /^description:\s*Report a reproducible problem found while testing The Beautiful Game/m);
  assert.doesNotMatch(form, /^about:/m);
  for (const field of ['Page / area', 'What did you do?', 'What did you expect to happen?', 'What actually happened?', 'Approximate time', 'Screenshot / extra evidence']) {
    assert.match(form, new RegExp(field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(form, /private account details, email addresses, magic links, credentials/i);
});

test('#310 landing-page guide link remains readable on the dark story panel', () => {
  const css = read('public/auth-fix.css');
  assert.match(css, /\.tbg-landing-story a\s*\{[\s\S]*color:\s*#fff2a8/i);
  assert.match(css, /\.tbg-landing-story a:visited\s*\{\s*color:\s*#f7e6ff/i);
  assert.match(css, /outline:\s*2px solid #FFDC02/i);
});

test('#310 guide puts post-matchday questions directly after tester-role guidance', () => {
  const guide = read('public/alpha-guide.html');
  for (const question of ['What confused you?', 'What was fun?', 'What felt like work?', 'What did you expect to be able to do but could not?', 'What decision felt meaningless?']) {
    assert.match(guide, new RegExp(question.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  const testerIndex = guide.indexOf('Your job as a tester');
  const feedbackIndex = guide.indexOf('Five questions we actually care about');
  const expectationsIndex = guide.indexOf('What to expect');
  assert.ok(testerIndex >= 0 && feedbackIndex > testerIndex && expectationsIndex > feedbackIndex);
});

test('#310 guide keeps the in-game report instruction concise', () => {
  const guide = read('public/alpha-guide.html');
  assert.match(guide, /Use <strong>Report \/ feedback<\/strong> in the Manager Portal\.<\/p>/);
  assert.doesNotMatch(guide, /does not require a GitHub account/i);
});
