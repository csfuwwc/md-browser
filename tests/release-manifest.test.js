import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

import { checkForUpdate, normalizeUpdateManifest } from "../src/server.js";

const require = createRequire(import.meta.url);
const {
  buildLegacyReleaseManifest,
  buildTauriReleaseManifest
} = require("../scripts/release_manifest.cjs");

function tempWorkspace() {
  return mkdtempSync(join(tmpdir(), "md-browser-release-"));
}

test("buildLegacyReleaseManifest keeps existing DMG manifest shape", () => {
  const root = tempWorkspace();
  const pkgPath = join(root, "package.json");
  const artifactPath = join(root, "MD-Browser_0.3.1_aarch64.dmg");
  writeFileSync(pkgPath, JSON.stringify({ version: "0.3.1", productName: "MD-Browser" }));
  writeFileSync(artifactPath, "fake-dmg");

  const manifest = buildLegacyReleaseManifest({
    packagePath: pkgPath,
    artifactPath,
    downloadBaseUrl: "https://example.com/releases",
    notes: ["first", "second"]
  });

  assert.equal(manifest.version, "0.3.1");
  assert.equal(manifest.fileName, "MD-Browser_0.3.1_aarch64.dmg");
  assert.equal(manifest.downloadUrl, "https://example.com/releases/MD-Browser_0.3.1_aarch64.dmg");
  assert.deepEqual(manifest.notes, ["first", "second"]);
});

test("buildTauriReleaseManifest creates latest.json shape", () => {
  const root = tempWorkspace();
  const pkgPath = join(root, "package.json");
  const bundleDir = join(root, "bundle");
  mkdirSync(bundleDir, { recursive: true });
  const artifactPath = join(bundleDir, "MD-Browser.app.tar.gz");
  const signaturePath = `${artifactPath}.sig`;
  writeFileSync(pkgPath, JSON.stringify({ version: "0.3.1", productName: "MD-Browser" }));
  writeFileSync(artifactPath, "fake-updater");
  writeFileSync(signaturePath, "signed-content");

  const manifest = buildTauriReleaseManifest({
    packagePath: pkgPath,
    artifactPath,
    signaturePath,
    downloadBaseUrl: "https://example.com/releases",
    notes: ["a", "b"],
    pubDate: "2026-06-14T12:00:00Z"
  });

  assert.equal(manifest.version, "0.3.1");
  assert.equal(manifest.pub_date, "2026-06-14T12:00:00Z");
  assert.equal(manifest.notes, "a\nb");
  assert.equal(manifest.platforms["darwin-aarch64"].signature, "signed-content");
  assert.equal(
    manifest.platforms["darwin-aarch64"].url,
    "https://example.com/releases/MD-Browser.app.tar.gz"
  );
});

test("normalizeUpdateManifest accepts tauri static JSON", () => {
  const normalized = normalizeUpdateManifest({
    version: "0.4.0",
    notes: "line 1\n- line 2",
    pub_date: "2026-06-14T12:00:00Z",
    platforms: {
      "darwin-aarch64": {
        url: "https://example.com/MD-Browser.app.tar.gz",
        signature: "signed-content"
      }
    }
  });

  assert.equal(normalized.version, "0.4.0");
  assert.equal(normalized.downloadUrl, "https://example.com/MD-Browser.app.tar.gz");
  assert.equal(normalized.signature, "signed-content");
  assert.deepEqual(normalized.notes, ["line 1", "line 2"]);
});

test("checkForUpdate supports tauri latest.json", async () => {
  const result = await checkForUpdate({
    currentVersion: "0.3.1",
    manifestUrl: "https://example.com/latest.json",
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return {
          version: "0.4.0",
          notes: "fix 1\nfix 2",
          platforms: {
            "darwin-aarch64": {
              url: "MD-Browser.app.tar.gz",
              signature: "signed"
            }
          }
        };
      }
    })
  });

  assert.equal(result.updateAvailable, true);
  assert.equal(result.latestVersion, "0.4.0");
  assert.equal(result.downloadUrl, "https://example.com/MD-Browser.app.tar.gz");
  assert.deepEqual(result.notes, ["fix 1", "fix 2"]);
  assert.equal(result.signature, "signed");
});
