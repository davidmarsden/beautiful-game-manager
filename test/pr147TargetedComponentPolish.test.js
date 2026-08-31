import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("targeted polish loads before the final Brazil design foundation", async () => {
  const html = await read("public/index.html");
  const stock = html.indexOf('./football-pink-stock.css');
  const polish = html.indexOf('./targeted-component-polish.css');
  const foundation = html.indexOf('./design-1982.css');
  assert.equal(stock, -1, "Football Pink stock layer must not load in the manager portal");
  assert.ok(polish >= 0, "targeted component polish should remain loaded");
  assert.ok(foundation > polish, "Brazil design foundation must remain the final portal art-direction layer");
});

test("tactics surfaces use Brazil neutrals while pitch and tactical slots keep contrast", async () => {
  const css = await read("public/targeted-component-polish.css");
  assert.match(css, /#tacticsView \.pitch-panel/);
  assert.match(css, /#tacticsView \.squad-tray-panel/);
  assert.match(css, /#tacticsView \.team-preset-panel/);
  assert.match(css, /background: #dbe8d5/);
  assert.match(css, /#tacticsView \.football-pitch[\s\S]*#267945/);
  assert.match(css, /#tacticsView \.formation-slot[\s\S]*#07304db8/);
});

test("competition matchday surfaces are green-neutral with yellow managed highlight preserved", async () => {
  const css = await read("public/targeted-component-polish.css");
  assert.match(css, /#competitionsView \.division-round-card/);
  assert.match(css, /#competitionsView \.division-round-fixture[\s\S]*#edf3e9/);
  assert.match(css, /#competitionsView \.round-count[\s\S]*#193375/);
  assert.match(css, /division-round-fixture\.managed-fixture[\s\S]*#fff0a8/);
});

test("World operational cards, controls and registration rows use Brazil surfaces", async () => {
  const css = await read("public/targeted-component-polish.css");
  assert.match(css, /#worldView \.world-control-summary article/);
  assert.match(css, /#worldView \.world-control-card/);
  assert.match(css, /#worldView \.bulk-registration-player/);
  assert.match(css, /#worldView \.bulk-registration-player em[\s\S]*var\(--tbg-colour-success\)/);
  assert.match(css, /#worldView \.world-control-card button[\s\S]*#214f70/);
  assert.doesNotMatch(css, /(^|\n)body\s*\{/);
  assert.doesNotMatch(css, /(^|\n):root\s*\{/);
});

test("dashboard inbox uses neutral read and unread states with no pink palette", async () => {
  const css = await read("public/targeted-component-polish.css");
  assert.match(css, /#dashboardView \.inbox-message\.read[\s\S]*#edf3e9/);
  assert.match(css, /#dashboardView \.inbox-message\.unread[\s\S]*#f4f6ef/);
  assert.match(css, /#dashboardView \.inbox-message\.unread:hover/);
  assert.doesNotMatch(css, /#f7dce1|#efcbd2|#f5d7dd|#f6d5dc|#f4d3da|#edc4cd|rgba\(247, 220, 225|rgba\(231, 168, 182|rgba\(242, 199, 208/i);
});

test("history archive cards use the rendered season-archive class", async () => {
  const css = await read("public/targeted-component-polish.css");
  assert.match(css, /#historyView \.season-archive/);
  assert.doesNotMatch(css, /#historyView \.history-season-card/);
});
