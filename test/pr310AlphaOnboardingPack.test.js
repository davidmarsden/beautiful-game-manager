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
  assert.match(guide, /Do not post private account or email information/i);
  assert.match(guide, /World Feed is the in-world community\/news space/i);
  assert.match(guide, /No cups yet/i);
  assert.match(guide, /loans and three-club deals/i);
  assert.match(auth, /alpha-guide\.html/);
});

test('#310 provides a structured external alpha bug-report form', () => {
  const form = read('.github/ISSUE_TEMPLATE/controlled-alpha-bug.yml');

  for (const field of ['Page / area', 'What did you do?', 'What did you expect to happen?', 'What actually happened?', 'Approximate time', 'Screenshot / extra evidence']) {
    assert.match(form, new RegExp(field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(form, /private account details, email addresses, magic links, credentials/i);
});

test('#310 guide includes the five post-matchday feedback questions', () => {
  const guide = read('public/alpha-guide.html');
  for (const question of ['What confused you?', 'What was fun?', 'What felt like work?', 'What did you expect to be able to do but could not?', 'What decision felt meaningless?']) {
    assert.match(guide, new RegExp(question.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});
