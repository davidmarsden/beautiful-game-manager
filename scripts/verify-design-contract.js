import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const manifest = JSON.parse(
  await readFile(new URL("design-contract/tbg-design-contract.manifest.json", root), "utf8"),
);
const css = await readFile(new URL(manifest.governedSource.path, root));
const text = css.toString("utf8");
const gitBlobSha = createHash("sha1")
  .update(`blob ${css.byteLength}\0`)
  .update(css)
  .digest("hex");

assert.equal(manifest.contract, "tbg-design-contract", "unexpected design contract name");
assert.match(
  manifest.version,
  /^\d+\.\d+\.\d+$/,
  "design contract version must use semantic versioning",
);
assert.match(
  text,
  new RegExp(`TBG visual contract v${manifest.version.replaceAll(".", "\\.")}`),
  "CSS header and manifest version differ",
);
assert.equal(
  gitBlobSha,
  manifest.governedSource.blobSha,
  "contract bytes changed without updating the manifest blob SHA and version",
);

for (const primitive of [
  ".tbg-nav",
  ".tbg-panel",
  ".tbg-card",
  ".tbg-table",
  ".tbg-badge",
  ".tbg-rating",
  ".tbg-player-link",
  ".tbg-club-link",
  ":focus-visible",
  "prefers-reduced-motion",
]) {
  assert.ok(text.includes(primitive), `shared primitive missing: ${primitive}`);
}

console.log(`Verified ${manifest.contract} v${manifest.version} (${gitBlobSha}).`);
