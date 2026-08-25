import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const navigation = fs.readFileSync(new URL('../public/portal-navigation.js', import.meta.url), 'utf8');

test('manager portal navigation uses the simplified labels and order', () => {
  const expected = [
    "['dashboard', 'Inbox']",
    "['feed', 'News']",
    "['squad', 'Squad']",
    "['tactics', 'Team']",
    "['schedule', 'Fixtures']",
    "['updates', 'Updates']",
    "['transfers', 'Transfers']",
    "['competitions', 'Competitions']",
    "['finance', 'Finances']",
    "['history', 'History']",
    "['managers', 'Managers']",
    "['world', 'World']"
  ];

  let previous = -1;
  for (const label of expected) {
    const index = navigation.indexOf(label);
    assert.ok(index > previous, `${label} should exist in the requested order`);
    previous = index;
  }
});

test('simplified labels retain compatibility aliases for existing routes', () => {
  assert.ok(navigation.includes("['inbox', 'dashboard']"));
  assert.ok(navigation.includes("['news', 'feed']"));
  assert.ok(navigation.includes("['team', 'tactics']"));
  assert.ok(navigation.includes("['fixtures', 'schedule']"));
});

test('Managers is a first-class portal view', () => {
  assert.ok(navigation.includes("['managers', 'managers']"));
  assert.ok(navigation.includes("section.id = 'managersView'"));
  assert.ok(navigation.includes("button.dataset.view = 'managers'"));
  assert.ok(navigation.includes("installManagersShell();"));
  assert.ok(!navigation.includes("managers.id = 'managersNavButton'"));
});
