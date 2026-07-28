import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const manifest = JSON.parse(
  await readFile(new URL("design-contract/tbg-design-contract.manifest.json", root), "utf8"),
);
const release = JSON.parse(await readFile(new URL(manifest.releaseRecord, root), "utf8"));
const css = await readFile(new URL(manifest.governedSource.path, root));
const text = css.toString("utf8");
const gitBlobSha = createHash("sha1")
  .update(`blob ${css.byteLength}\0`)
  .update(css)
  .digest("hex");

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const hasCompleteSelector = (selector) => new RegExp(
  `(^|[},]\\s*)${escapeRegExp(selector)}(?=\\s*[,\\{])`,
  "m",
).test(text);

assert.equal(manifest.contract, "tbg-design-contract", "unexpected design contract name");
assert.match(
  manifest.version,
  /^\d+\.\d+\.\d+$/,
  "design contract version must use semantic versioning",
);
assert.equal(
  manifest.releaseRecord,
  `design-contract/releases/${manifest.version}.json`,
  "manifest must point to the immutable record for its semantic version",
);
assert.deepEqual(
  {
    contract: release.contract,
    version: release.version,
    blobSha: release.blobSha,
    sourcePath: release.sourcePath,
    status: release.status,
  },
  {
    contract: manifest.contract,
    version: manifest.version,
    blobSha: manifest.governedSource.blobSha,
    sourcePath: manifest.governedSource.path,
    status: "immutable-release-record",
  },
  "contract bytes require a new semantic version and immutable release record",
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

for (const selector of [
  ".tbg-nav",
  ".tbg-panel",
  ".tbg-card",
  ".tbg-table",
  ".tbg-badge",
  ".tbg-rating",
  ".tbg-player-link",
  ".tbg-club-link",
]) {
  assert.ok(hasCompleteSelector(selector), `shared primitive selector missing: ${selector}`);
}

assert.match(text, /:focus-visible/, "shared focus-visible treatment missing");
assert.match(text, /prefers-reduced-motion/, "shared reduced-motion treatment missing");

console.log(`Verified ${manifest.contract} v${manifest.version} (${gitBlobSha}).`);
