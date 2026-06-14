const { readdirSync, statSync } = require("node:fs");
const { join } = require("node:path");
const { spawnSync } = require("node:child_process");

function walk(dir, results = []) {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      walk(fullPath, results);
      continue;
    }
    if (stats.isFile()) results.push(fullPath);
  }
  return results;
}

function removeSignature(targetPath) {
  const result = spawnSync("codesign", ["--remove-signature", targetPath], {
    encoding: "utf8"
  });
  return result.status === 0;
}

exports.default = async function postprocessUnsignedMac(context) {
  const identity = context?.packager?.platformSpecificBuildOptions?.identity;
  if (context.electronPlatformName !== "darwin" || identity !== null) return;
  const appOutDir = context.appOutDir;
  const productFilename = context.packager.appInfo.productFilename;
  const appPath = join(appOutDir, `${productFilename}.app`);
  let removedCount = 0;

  for (const filePath of walk(appPath)) {
    if (removeSignature(filePath)) removedCount += 1;
  }

  // Try the top-level bundle last so the final state is fully unsigned.
  removeSignature(appPath);
  console.log(`Removed embedded signatures from ${removedCount} files for unsigned mac build.`);
};
