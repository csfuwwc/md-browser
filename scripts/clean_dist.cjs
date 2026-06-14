#!/usr/bin/env node
const { rmSync } = require("node:fs");
const { resolve } = require("node:path");

const root = resolve(__dirname, "..");
const allowed = new Set(["dist", "dist-tauri", "src-tauri/target/release/bundle"]);
const targets = process.argv.slice(2);

for (const target of targets) {
  if (!allowed.has(target)) {
    throw new Error(`Refusing to clean unsupported path: ${target}`);
  }
  const absolute = resolve(root, target);
  if (!absolute.startsWith(`${root}/`)) {
    throw new Error(`Refusing to clean outside project: ${target}`);
  }
  rmSync(absolute, { recursive: true, force: true });
  console.log(`Cleaned ${target}`);
}
