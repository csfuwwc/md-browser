#!/usr/bin/env node
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { dirname, join, resolve } = require("node:path");
const { buildReleaseManifest, writeReleaseManifest } = require("./release_manifest.cjs");

function readPackage() {
  return JSON.parse(readFileSync(resolve("package.json"), "utf8"));
}

function repositoryBaseUrl(pkg) {
  return String(pkg.repository?.url || pkg.homepage || "")
    .trim()
    .replace(/^git\+/, "")
    .replace(/\.git$/i, "")
    .replace(/#.*$/, "");
}

function extractLatestChangelog(markdown, version) {
  const lines = String(markdown || "").split(/\r?\n/);
  const expected = `## v${String(version).replace(/^v/i, "")}`;
  const start = lines.findIndex((line) => line.trim().startsWith(expected));
  if (start < 0) return { heading: "", body: "", notes: [] };
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s+v/i.test(lines[index].trim())) {
      end = index;
      break;
    }
  }
  const block = lines.slice(start, end);
  const heading = block[0]?.trim() || expected;
  const notes = block
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim())
    .filter(Boolean);
  return {
    heading,
    body: block.join("\n").trim(),
    notes
  };
}

function writeFile(outputPath, content) {
  const resolved = resolve(outputPath);
  mkdirSync(dirname(resolved), { recursive: true });
  writeFileSync(resolved, content);
  return resolved;
}

function main() {
  const pkg = readPackage();
  const productName = pkg.build?.productName || "MD-Browser";
  const version = String(pkg.version || "").replace(/^v/i, "");
  const changelog = readFileSync(resolve("CHANGELOG.md"), "utf8");
  const latest = extractLatestChangelog(changelog, version);
  const artifactPath = process.env.MD_BROWSER_RELEASE_ARTIFACT
    || join("dist", `${productName}-${version}-arm64.dmg`);
  if (!existsSync(resolve(artifactPath))) {
    throw new Error(`Release artifact not found: ${resolve(artifactPath)}`);
  }

  const notes = latest.notes.length
    ? latest.notes
    : (process.env.MD_BROWSER_RELEASE_NOTES || "").split("|").map((item) => item.trim()).filter(Boolean);

  const manifest = buildReleaseManifest({
    artifactPath,
    downloadBaseUrl: process.env.MD_BROWSER_RELEASE_BASE_URL || "",
    channel: process.env.MD_BROWSER_RELEASE_CHANNEL || "internal",
    notes
  });

  const manifestPath = writeReleaseManifest(
    manifest,
    process.env.MD_BROWSER_RELEASE_MANIFEST || join("dist", "latest-mac-arm64.json")
  );
  const notesPath = writeFile(
    process.env.MD_BROWSER_RELEASE_NOTES_FILE || join("dist", `release-notes-v${version}.md`),
    `${latest.body || `## v${version}`}\n`
  );
  const repoBase = repositoryBaseUrl(pkg);
  const summary = {
    version: `v${version}`,
    artifactPath: resolve(artifactPath),
    manifestPath,
    releaseNotesPath: notesPath,
    downloadUrl: manifest.downloadUrl,
    releasePageUrl: repoBase ? `${repoBase}/releases/tag/v${version}` : "",
    sha256: manifest.sha256,
    notes
  };
  const summaryPath = writeFile(
    process.env.MD_BROWSER_RELEASE_SUMMARY || join("dist", `release-summary-v${version}.json`),
    `${JSON.stringify(summary, null, 2)}\n`
  );

  console.log(`Release manifest: ${manifestPath}`);
  console.log(`Release notes: ${notesPath}`);
  console.log(`Release summary: ${summaryPath}`);
  console.log(`Version: v${version}`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
