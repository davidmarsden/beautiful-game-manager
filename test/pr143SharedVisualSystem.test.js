import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("shared visual contract exposes governed foundation tokens", async () => {
  const css = await read("public/tbg-design-contract.css");
  const requiredTokens = [
    "--tbg-colour-paper",
    "--tbg-colour-ink",
    "--tbg-surface-panel",
    "--tbg-font-display",
    "--tbg-font-ui",
    "--tbg-space-4",
    "--tbg-nav-height",
    "--tbg-table-row-height",
    "--tbg-breakpoint-compact",
    "--tbg-colour-focus",
  ];

  for (const token of requiredTokens) {
    assert.match(css, new RegExp(token), `missing ${token}`);
  }
});

test("shared primitives cover navigation, panels, tables, badges and links", async () => {
  const css = await read("public/tbg-design-contract.css");
  for (const primitive of [
    ".tbg-nav",
    ".tbg-panel",
    ".tbg-card",
    ".tbg-table",
    ".tbg-rating",
    ".tbg-badge--available",
    ".tbg-badge--competition",
    ".tbg-player-link",
    ".tbg-club-link",
    ":focus-visible",
    "prefers-reduced-motion",
  ]) {
    assert.ok(css.includes(primitive), `missing ${primitive}`);
  }
});

test("manager portal loads the shared contract through its final stylesheet", async () => {
  const css = await read("public/player-profile.css");
  assert.match(css, /^@import url\("\.\/tbg-design-contract\.css"\);/);
  assert.match(css, /@import url\("\.\/manager-portal-theme\.css"\);/);
});

test("manager theme keeps an operational workspace layer", async () => {
  const css = await read("public/manager-portal-theme.css");
  assert.match(css, /\.tabs button\.active/);
  assert.match(css, /tbody tr\[aria-selected="true"\]/);
  assert.match(css, /\.squad-summary div/);
  assert.match(css, /table \{ min-width: 680px; \}/);
});
