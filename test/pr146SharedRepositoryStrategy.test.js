import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path, encoding = "utf8") => readFile(new URL(`../${path}`, import.meta.url), encoding);

const gitBlobSha = (buffer) => createHash("sha1")
  .update(`blob ${buffer.byteLength}\0`)
  .update(buffer)
  .digest("hex");

test("design contract manifest pins semantic version and governed source bytes", async () => {
  const manifest = JSON.parse(await read("design-contract/tbg-design-contract.manifest.json"));
  const css = await read(manifest.governedSource.path, null);
  const text = css.toString("utf8");

  assert.equal(manifest.contract, "tbg-design-contract");
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.governedSource.repository, "davidmarsden/beautiful-game-manager");
  assert.equal(manifest.governedSource.blobSha, gitBlobSha(css));
  assert.match(text, new RegExp(`TBG visual contract v${manifest.version.replaceAll(".", "\\.")}`));
});

test("consumer strategy preserves independent deployment and rollback", async () => {
  const [manifestText, strategy] = await Promise.all([
    read("design-contract/tbg-design-contract.manifest.json"),
    read("docs/manager-portal/shared-component-repository-strategy.md"),
  ]);
  const manifest = JSON.parse(manifestText);
  const consumers = new Map(manifest.consumers.map((consumer) => [consumer.repository, consumer]));

  assert.equal(consumers.get("davidmarsden/beautiful-game-manager")?.role, "source-and-consumer");
  assert.equal(consumers.get("davidmarsden/beautiful-game-data")?.role, "versioned-copy");
  assert.match(strategy, /neither application downloads presentation code from the other at build time or runtime/i);
  assert.match(strategy, /A consumer upgrade is never automatic/i);
  assert.match(strategy, /Rollback procedure/);
});

test("critical shared primitives have a stable visual review surface", async () => {
  const [css, preview] = await Promise.all([
    read("public/tbg-design-contract.css"),
    read("public/design-contract-preview.html"),
  ]);

  for (const primitive of [
    "tbg-nav",
    "tbg-panel",
    "tbg-card",
    "tbg-table-wrap",
    "tbg-table",
    "tbg-rating",
    "tbg-badge--available",
    "tbg-badge--injured",
    "tbg-player-link",
    "tbg-club-link",
  ]) {
    assert.ok(css.includes(`.${primitive}`), `contract missing .${primitive}`);
    assert.ok(preview.includes(primitive), `preview missing ${primitive}`);
  }

  assert.match(preview, /aria-selected="true"/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /@media \(max-width: 560px\)/);
});

test("strategy keeps product rendering outside the shared contract", async () => {
  const strategy = await read("docs/manager-portal/shared-component-repository-strategy.md");
  assert.match(strategy, /duplicated concern is semantic presentation, not application rendering/i);
  assert.match(strategy, /Squad operations, manager controls, newspaper mastheads/i);
  assert.match(strategy, /must not define canonical player or club fields, permissions, hidden world state/i);
});
