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

test('#310 guide includes the five post-matchday feedback questions', () => {
  const guide = read('public/alpha-guide.html');
  for (const question of ['What confused you?', 'What was fun?', 'What felt like work?', 'What did you expect to be able to do but could not?', 'What decision felt meaningless?']) {
    assert.match(guide, new RegExp(question.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});
