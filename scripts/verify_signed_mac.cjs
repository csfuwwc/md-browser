#!/usr/bin/env node
const { existsSync, readdirSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { spawnSync } = require("node:child_process");

const root = resolve(__dirname, "..");
const distSigned = join(root, "dist-signed");
const appPath = join(distSigned, "mac-arm64", "MD-Browser.app");

function fail(message) {
  console.error(message);
  process.exit(1);
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) fail(`${command} failed: ${result.error.message}`);
  if (result.status !== 0) fail(`${command} exited with ${result.status}`);
}

if (!existsSync(appPath)) {
  fail(`Signed app not found: ${appPath}`);
}

const dmg = existsSync(distSigned)
  ? readdirSync(distSigned)
    .filter((name) => /^MD-Browser-\d+\.\d+\.\d+-arm64-signed\.dmg$/.test(name))
    .sort()
    .at(-1)
  : "";

if (!dmg) {
  fail(`Signed DMG not found in ${distSigned}`);
}

const dmgPath = join(distSigned, dmg);

run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath]);
run("xcrun", ["stapler", "validate", appPath]);
run("spctl", ["--assess", "--verbose", "--type", "exec", appPath]);
run("hdiutil", ["verify", dmgPath]);

console.log("Signed macOS release verified.");
console.log(`App: ${appPath}`);
console.log(`DMG: ${dmgPath}`);
