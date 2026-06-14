#!/usr/bin/env node
const { createHash } = require("node:crypto");
const { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } = require("node:fs");
const { basename, dirname, join, resolve } = require("node:path");

function sha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function normalizeBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function buildReleaseManifest({
  packagePath = "package.json",
  artifactPath,
  downloadBaseUrl = "",
  channel = "internal",
  notes = []
} = {}) {
  if (!artifactPath) throw new Error("artifactPath is required.");
  const resolvedArtifact = resolve(artifactPath);
  if (!existsSync(resolvedArtifact)) throw new Error(`Artifact not found: ${resolvedArtifact}`);

  const packageJson = JSON.parse(readFileSync(resolve(packagePath), "utf8"));
  const fileName = basename(resolvedArtifact);
  const baseUrl = normalizeBaseUrl(downloadBaseUrl);
  const stat = statSync(resolvedArtifact);

  return {
    productName: packageJson.build?.productName || "MD-Browser",
    version: packageJson.version,
    channel,
    platform: "mac",
    arch: "arm64",
    fileName,
    downloadUrl: baseUrl ? `${baseUrl}/${encodeURIComponent(fileName)}` : fileName,
    sha256: sha256(resolvedArtifact),
    size: stat.size,
    generatedAt: new Date().toISOString(),
    minimumConfigVersion: 1,
    notes
  };
}

function writeReleaseManifest(manifest, outputPath) {
  const resolvedOutput = resolve(outputPath);
  mkdirSync(dirname(resolvedOutput), { recursive: true });
  writeFileSync(resolvedOutput, `${JSON.stringify(manifest, null, 2)}\n`);
  return resolvedOutput;
}

function main() {
  const artifactPath = process.env.MD_BROWSER_RELEASE_ARTIFACT
    || join("dist", "MD-Browser-0.1.0-arm64.dmg");
  const outputPath = process.env.MD_BROWSER_RELEASE_MANIFEST
    || join("dist", "latest-mac-arm64.json");
  const downloadsCopy = process.env.MD_BROWSER_RELEASE_MANIFEST_COPY || "";
  const notes = (process.env.MD_BROWSER_RELEASE_NOTES || "")
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean);

  const manifest = buildReleaseManifest({
    artifactPath,
    downloadBaseUrl: process.env.MD_BROWSER_RELEASE_BASE_URL || "",
    channel: process.env.MD_BROWSER_RELEASE_CHANNEL || "internal",
    notes
  });
  const written = writeReleaseManifest(manifest, outputPath);
  if (downloadsCopy) {
    mkdirSync(dirname(resolve(downloadsCopy)), { recursive: true });
    copyFileSync(written, resolve(downloadsCopy));
  }
  console.log(`Release manifest written: ${written}`);
  console.log(`SHA-256: ${manifest.sha256}`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  buildReleaseManifest,
  normalizeBaseUrl,
  sha256,
  writeReleaseManifest
};
