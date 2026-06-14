#!/usr/bin/env node
const { existsSync } = require("node:fs");
const { spawnSync } = require("node:child_process");

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

function has(value) {
  return typeof value === "string" && value.trim().length > 0;
}

const identities = spawnSync("security", ["find-identity", "-v", "-p", "codesigning"], { encoding: "utf8" });
if (identities.status !== 0) {
  fail("Unable to inspect macOS code signing identities. Make sure Xcode command line tools are installed.");
} else if (!/Developer ID Application/.test(identities.stdout || "")) {
  fail("Developer ID Application certificate was not found in the current keychain.");
}

const apiKeyReady = has(process.env.APPLE_API_KEY)
  && existsSync(process.env.APPLE_API_KEY)
  && has(process.env.APPLE_API_KEY_ID)
  && has(process.env.APPLE_API_ISSUER)
  && has(process.env.APPLE_TEAM_ID);

const appleIdReady = has(process.env.APPLE_ID)
  && has(process.env.APPLE_APP_SPECIFIC_PASSWORD)
  && has(process.env.APPLE_TEAM_ID);

if (!apiKeyReady && !appleIdReady) {
  fail("Notarization credentials are missing. Set App Store Connect API key env vars or Apple ID env vars.");
}

if (process.exitCode) {
  process.exit();
}

console.log("Signed macOS release preflight passed.");
