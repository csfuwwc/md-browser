import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { buildReleaseManifest, normalizeBaseUrl, sha256, writeReleaseManifest } = require("../scripts/release_manifest.cjs");

test("normalizeBaseUrl removes trailing slashes", () => {
  assert.equal(normalizeBaseUrl("https://downloads.example.com/md///"), "https://downloads.example.com/md");
  assert.equal(normalizeBaseUrl(""), "");
});

test("buildReleaseManifest writes version, download URL, SHA and size", () => {
  const dir = mkdtempSync(join(tmpdir(), "md-browser-release-manifest-"));
  try {
    const packagePath = join(dir, "package.json");
    const artifactPath = join(dir, "MD-Browser-0.2.0-arm64.dmg");
    const outputPath = join(dir, "latest-mac-arm64.json");

    writeFileSync(packagePath, JSON.stringify({
      version: "0.2.0",
      build: { productName: "MD-Browser" }
    }));
    writeFileSync(artifactPath, "fake-dmg");

    const manifest = buildReleaseManifest({
      packagePath,
      artifactPath,
      downloadBaseUrl: "https://downloads.example.com/md-browser/",
      channel: "beta",
      notes: ["诊断信息", "内置 Mihomo"]
    });
    writeReleaseManifest(manifest, outputPath);
    const saved = JSON.parse(readFileSync(outputPath, "utf8"));

    assert.equal(saved.productName, "MD-Browser");
    assert.equal(saved.version, "0.2.0");
    assert.equal(saved.channel, "beta");
    assert.equal(saved.downloadUrl, "https://downloads.example.com/md-browser/MD-Browser-0.2.0-arm64.dmg");
    assert.equal(saved.sha256, "a93b94ffef56a7c5cd60bba382e95a01fec5e0a580b9a1d3f7e78f8a54b8432f");
    assert.equal(saved.size, 8);
    assert.deepEqual(saved.notes, ["诊断信息", "内置 Mihomo"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sha256 returns stable artifact checksum", () => {
  const dir = mkdtempSync(join(tmpdir(), "md-browser-release-sha-"));
  try {
    const artifactPath = join(dir, "artifact.dmg");
    writeFileSync(artifactPath, "fake-dmg");
    assert.equal(sha256(artifactPath), "a93b94ffef56a7c5cd60bba382e95a01fec5e0a580b9a1d3f7e78f8a54b8432f");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
