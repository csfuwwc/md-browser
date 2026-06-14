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

function buildLegacyReleaseManifest({
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
    productName: packageJson.productName || packageJson.build?.productName || "MD-Browser",
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

function inferTauriTarget(artifactPath) {
  const fileName = basename(resolve(artifactPath)).toLowerCase();
  if (fileName.includes("aarch64") || fileName.includes("arm64")) return "darwin-aarch64";
  if (fileName.includes("x64") || fileName.includes("x86_64")) return "darwin-x86_64";
  return "darwin-aarch64";
}

function buildTauriReleaseManifest({
  packagePath = "package.json",
  artifactPath,
  signaturePath,
  downloadBaseUrl = "",
  notes = [],
  pubDate = new Date().toISOString(),
  target
} = {}) {
  if (!artifactPath) throw new Error("artifactPath is required.");
  if (!signaturePath) throw new Error("signaturePath is required.");
  const resolvedArtifact = resolve(artifactPath);
  const resolvedSignature = resolve(signaturePath);
  if (!existsSync(resolvedArtifact)) throw new Error(`Artifact not found: ${resolvedArtifact}`);
  if (!existsSync(resolvedSignature)) throw new Error(`Signature not found: ${resolvedSignature}`);

  const packageJson = JSON.parse(readFileSync(resolve(packagePath), "utf8"));
  const fileName = basename(resolvedArtifact);
  const baseUrl = normalizeBaseUrl(downloadBaseUrl);
  const resolvedTarget = target || inferTauriTarget(resolvedArtifact);

  return {
    version: packageJson.version,
    notes: Array.isArray(notes) ? notes.join("\n") : String(notes || ""),
    pub_date: pubDate,
    platforms: {
      [resolvedTarget]: {
        signature: readFileSync(resolvedSignature, "utf8").trim(),
        url: baseUrl ? `${baseUrl}/${encodeURIComponent(fileName)}` : fileName
      }
    }
  };
}

function writeReleaseManifest(manifest, outputPath) {
  const resolvedOutput = resolve(outputPath);
  mkdirSync(dirname(resolvedOutput), { recursive: true });
  writeFileSync(resolvedOutput, `${JSON.stringify(manifest, null, 2)}\n`);
  return resolvedOutput;
}

function main() {
  const packageJson = JSON.parse(readFileSync(resolve("package.json"), "utf8"));
  const productName = packageJson.productName || packageJson.build?.productName || "MD-Browser";
  const format = String(process.env.MD_BROWSER_RELEASE_MANIFEST_FORMAT || "legacy").trim().toLowerCase();
  const artifactPath = process.env.MD_BROWSER_RELEASE_ARTIFACT
    || (format === "tauri"
      ? join("src-tauri", "target", "release", "bundle", "macos", `${productName}.app.tar.gz`)
      : join("src-tauri", "target", "release", "bundle", "dmg", `${productName}_${packageJson.version}_aarch64.dmg`));
  const outputPath = process.env.MD_BROWSER_RELEASE_MANIFEST
    || join(format === "tauri" ? "dist-tauri" : "dist", format === "tauri" ? "latest.json" : "latest-mac-arm64.json");
  const downloadsCopy = process.env.MD_BROWSER_RELEASE_MANIFEST_COPY || "";
  const notes = (process.env.MD_BROWSER_RELEASE_NOTES || "")
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean);

  const manifest = format === "tauri"
    ? buildTauriReleaseManifest({
      artifactPath,
      signaturePath: process.env.MD_BROWSER_RELEASE_SIGNATURE
        || `${artifactPath}.sig`,
      downloadBaseUrl: process.env.MD_BROWSER_RELEASE_BASE_URL || "",
      notes,
      pubDate: process.env.MD_BROWSER_RELEASE_PUB_DATE || new Date().toISOString(),
      target: process.env.MD_BROWSER_RELEASE_TARGET || ""
    })
    : buildLegacyReleaseManifest({
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
  buildLegacyReleaseManifest,
  buildTauriReleaseManifest,
  inferTauriTarget,
  normalizeBaseUrl,
  sha256,
  writeReleaseManifest
};
