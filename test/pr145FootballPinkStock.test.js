import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("portal loads the Football Pink stock refinement last", async () => {
  const html = await read("public/index.html");
  const profileIndex = html.indexOf("./player-profile.css");
  const pinkIndex = html.indexOf("./football-pink-stock.css");

  assert.ok(profileIndex >= 0, "player profile stylesheet missing");
  assert.ok(pinkIndex > profileIndex, "Football Pink refinement must load after the shared theme");
});

test("Football Pink stock uses pink paper rather than near-white surfaces", async () => {
  const css = await read("public/football-pink-stock.css");

  for (const token of [
    "--tbg-colour-paper: #e7a8b6",
    "--tbg-colour-paper-light: #f2c7d0",
    "--tbg-colour-workspace: #efbcc7",
    "--tbg-surface-card: #f5d7dd",
    "--tbg-surface-table: #f3d2d8",
  ]) {
    assert.ok(css.includes(token), `missing ${token}`);
  }

  assert.doesNotMatch(css, /#fffaf0|#fff\b|rgba\(255,\s*255,\s*255,\s*\.[3-9]/i);
});

test("portal cards tables and inbox all receive pink stock surfaces", async () => {
  const css = await read("public/football-pink-stock.css");

  assert.match(css, /\.portal-overview article,[\s\S]*\.portal-card,[\s\S]*background: var\(--tbg-surface-card\)/);
  assert.match(css, /table,[\s\S]*\.tbg-table[\s\S]*background: var\(--tbg-surface-table\)/);
  assert.match(css, /\.inbox-message[\s\S]*background: #f3d6dc/);
  assert.match(css, /tbody tr:nth-child\(even\)/);
});

test("mobile sticky cells keep opaque interaction and managed-club states", async () => {
  const css = await read("public/football-pink-stock.css");

  assert.match(css, /td:first-child,[\s\S]*\.tbg-table td:first-child[\s\S]*background: var\(--tbg-surface-table\)/);
  assert.match(css, /tbody tr:hover td:first-child/);
  assert.match(css, /tbody tr\.managed-club-row td:first-child[\s\S]*background: #fff0a8/);
});
