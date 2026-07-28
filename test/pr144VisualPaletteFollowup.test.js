import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("portal palette uses Pink Final pink rather than beige workspace surfaces", async () => {
  const css = await read("public/manager-portal-theme.css");
  assert.match(css, /--tbg-colour-workspace: #f6c3cb/);
  assert.match(css, /--tbg-colour-workspace-raised: #ffe1e5/);
  assert.match(css, /background:\s*var\(--tbg-colour-ink\);\s*font-weight: 900/);
  assert.doesNotMatch(css, /#f8eee1|#fffaf0/);
});

test("first navigation link does not override active hover or focus treatment", async () => {
  const css = await read("public/manager-portal-theme.css");
  assert.match(
    css,
    /\.club-nav a:first-child:not\(\[aria-current="page"\]\):not\(:hover\):not\(:focus-visible\)/,
  );
  assert.doesNotMatch(css, /\.club-nav a:first-child \{ background: transparent; \}/);
});

test("sticky mobile table cells use opaque surfaces with interaction overrides", async () => {
  for (const path of ["public/tbg-design-contract.css", "public/manager-portal-theme.css"]) {
    const css = await read(path);
    assert.match(css, /td:first-child \{ background: var\(--tbg-surface-card\); \}/);
    assert.match(css, /tr:hover td:first-child/);
    assert.match(css, /tr\.is-selected td:first-child/);
    assert.doesNotMatch(css, /td:first-child[^}]*background: inherit/s);
  }
});

test("managed club row keeps its mobile sticky-cell highlight", async () => {
  const css = await read("public/manager-portal-theme.css");
  assert.match(css, /tbody tr\.managed-club-row td:first-child \{ background: #fff0a8; \}/);
});

test("adoption guide matches visual contract version 1.0.1", async () => {
  const [contract, guide] = await Promise.all([
    read("public/tbg-design-contract.css"),
    read("docs/manager-portal/shared-visual-system.md"),
  ]);
  assert.match(contract, /TBG visual contract v1\.0\.1/);
  assert.match(guide, /Version: \*\*1\.0\.1\*\*/);
  assert.match(guide, /at version 1\.0\.1 into `beautiful-game-data`/);
  assert.doesNotMatch(guide, /at version 1\.0\.0 into `beautiful-game-data`/);
});
