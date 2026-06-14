const { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");

const rootDir = process.cwd();
const sourceDir = join(rootDir, "web");
const outputDir = join(rootDir, "dist-tauri", "web");

rmSync(outputDir, { recursive: true, force: true });
mkdirSync(outputDir, { recursive: true });
cpSync(sourceDir, outputDir, { recursive: true });

function rewriteHtml(fileName) {
  const filePath = join(outputDir, fileName);
  let html = readFileSync(filePath, "utf8");
  html = html
    .replace('href="/styles.css?v=94"', 'href="./styles.css?v=94"')
    .replace('src="/assets/md-browser-logo.png"', 'src="./assets/md-browser-logo.png"')
    .replace('src="/app.js?v=113"', 'src="./app.js?v=113"');
  writeFileSync(filePath, html);
}

rewriteHtml("index.html");
rewriteHtml("identity.html");

console.log(`Tauri web assets prepared at ${outputDir}`);
