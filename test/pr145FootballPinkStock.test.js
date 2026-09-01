import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Football Pink stock remains archived but is not loaded by the manager portal", async () => {
  const html = await read("public/index.html");
  const css = await read("public/football-pink-stock.css");

  assert.ok(css.includes("--tbg-colour-paper: #e7a8b6"), "legacy Football Pink stylesheet should remain available for history/reference");
  assert.doesNotMatch(html, /football-pink-stock\.css/, "manager portal must not load the obsolete Football Pink theme");
  assert.match(html, /design-1982\.css/, "replacement visual foundation missing");
});

test("Football Pink stock retains its historical pink surface definitions", async () => {
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
});

test("current visual foundation remaps legacy surface variables away from pink", async () => {
  const css = await read("public/design-1982.css");
  assert.match(css, /--tbg-colour-paper:#267945/);
  assert.match(css, /--tbg-colour-paper-strong:#164b2a/);
  assert.match(css, /--tbg-colour-paper-light:#dbe8d5/);
  assert.match(css, /--tbg-colour-workspace:#dbe8d5/);
  assert.match(css, /--tbg-surface-card:#eef3eb/);
  assert.match(css, /--tbg-surface-table:#f4f6ef/);
  assert.doesNotMatch(css, /#e7a8b6|#f2c7d0|#efbcc7|#f5d7dd|#f3d2d8/);
});
