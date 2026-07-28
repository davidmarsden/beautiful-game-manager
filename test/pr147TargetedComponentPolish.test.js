import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("targeted polish loads after the final Football Pink stock layer", async () => {
  const html = await read("public/index.html");
  const stock = html.indexOf('./football-pink-stock.css');
  const polish = html.indexOf('./targeted-component-polish.css');
  assert.ok(stock >= 0, "Football Pink stock layer should remain loaded");
  assert.ok(polish > stock, "targeted overrides must load after the rollback-safe stock layer");
});

test("tactics surfaces move to pink stock while pitch and tactical slots keep contrast", async () => {
  const css = await read("public/targeted-component-polish.css");
  assert.match(css, /#tacticsView \.pitch-panel/);
  assert.match(css, /#tacticsView \.squad-tray-panel/);
  assert.match(css, /#tacticsView \.team-preset-panel/);
  assert.doesNotMatch(css, /#tacticsView \.preset-panel/);
  assert.match(css, /background: var\(--tbg-surface-card\)/);
  assert.match(css, /#tacticsView \.football-pitch[\s\S]*#267945/);
  assert.match(css, /#tacticsView \.formation-slot[\s\S]*#07304db8/);
});

test("competition matchday surfaces use pink, black and cream with managed highlight preserved", async () => {
  const css = await read("public/targeted-component-polish.css");
  assert.match(css, /#competitionsView \.division-round-card/);
  assert.match(css, /#competitionsView \.division-round-fixture[\s\S]*#f7dce1|rgba\(247, 220, 225, \.72\)/);
  assert.match(css, /#competitionsView \.round-count[\s\S]*var\(--tbg-colour-ink\)/);
  assert.match(css, /division-round-fixture\.managed-fixture[\s\S]*#fff0a8/);
});

test("World operational cards, controls and registration rows are targeted rather than globally recoloured", async () => {
  const css = await read("public/targeted-component-polish.css");
  assert.match(css, /#worldView \.world-control-summary article/);
  assert.match(css, /#worldView \.world-control-card/);
  assert.match(css, /#worldView \.bulk-registration-player/);
  assert.match(css, /#worldView \.bulk-registration-player em[\s\S]*var\(--tbg-colour-success\)/);
  assert.match(css, /#worldView \.world-control-card input/);
  assert.doesNotMatch(css, /(^|\n)body\s*\{/);
  assert.doesNotMatch(css, /(^|\n):root\s*\{/);
});

test("dashboard inbox has distinct read and unread pink-paper states", async () => {
  const css = await read("public/targeted-component-polish.css");
  assert.match(css, /#dashboardView \.inbox-message\.read[\s\S]*#efcbd2/);
  assert.match(css, /#dashboardView \.inbox-message\.unread[\s\S]*#f5d7dd/);
  assert.match(css, /#dashboardView \.inbox-message\.unread:hover/);
});

test("history archive cards use the rendered season-archive class", async () => {
  const css = await read("public/targeted-component-polish.css");
  assert.match(css, /#historyView \.season-archive/);
  assert.doesNotMatch(css, /#historyView \.history-season-card/);
});

test("visual preview covers every migrated component cluster", async () => {
  const html = await read("public/targeted-component-polish-preview.html");
  for (const id of ["tacticsView", "competitionsView", "worldView", "dashboardView"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /targeted-component-polish\.css/);
  assert.match(html, /football-pink-stock\.css/);
});
