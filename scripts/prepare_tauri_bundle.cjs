const { cpSync, chmodSync, existsSync, mkdirSync, rmSync } = require("node:fs");
const { dirname, join } = require("node:path");

const rootDir = process.cwd();
const bundleRoot = join(rootDir, "tauri-bundle");
const runtimeDir = join(bundleRoot, "runtime");
const appDir = join(bundleRoot, "app");
const nodeBinary = process.execPath;

rmSync(bundleRoot, { recursive: true, force: true });
mkdirSync(runtimeDir, { recursive: true });
mkdirSync(appDir, { recursive: true });

const nodeTarget = join(runtimeDir, "node");
cpSync(nodeBinary, nodeTarget);
chmodSync(nodeTarget, 0o755);

for (const relativePath of ["src", "web", "mcp", "config", "package.json"]) {
  const from = join(rootDir, relativePath);
  const to = join(appDir, relativePath);
  if (!existsSync(from)) continue;
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to, { recursive: true });
}

console.log(`Bundled Node runtime: ${nodeTarget}`);
console.log(`Bundled app files: ${appDir}`);
