import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { gzipSync } from "node:zlib";
import {
  buildEmbeddedMihomoConfig,
  embeddedMihomoPaths,
  embeddedMihomoStatus,
  installEmbeddedMihomo,
  selectMihomoReleaseAsset,
  startEmbeddedMihomo,
  stopEmbeddedMihomo
} from "../src/embedded-mihomo.js";

test("embeddedMihomoPaths expands configured binary and config paths", () => {
  const home = mkdtempSync(join(tmpdir(), "md-browser-embedded-"));
  try {
    const paths = embeddedMihomoPaths({
      binaryPath: "~/Library/Application Support/MD-Browser/bin/mihomo",
      configPath: "~/Library/Application Support/MD-Browser/mihomo/config.yaml"
    }, home);

    assert.equal(paths.binaryPath, join(home, "Library/Application Support/MD-Browser/bin/mihomo"));
    assert.equal(paths.configPath, join(home, "Library/Application Support/MD-Browser/mihomo/config.yaml"));
    assert.equal(paths.workDir, join(home, "Library/Application Support/MD-Browser/mihomo"));
    assert.equal(paths.pidPath, join(home, "Library/Application Support/MD-Browser/mihomo/mihomo.pid"));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("selectMihomoReleaseAsset chooses darwin arm64 gz asset", () => {
  const release = {
    tag_name: "v1.19.27",
    assets: [
      { name: "mihomo-linux-amd64-v1.19.27.gz", browser_download_url: "linux-url" },
      { name: "mihomo-darwin-amd64-compatible-v1.19.27.gz", browser_download_url: "amd-url" },
      { name: "mihomo-darwin-arm64-go120-v1.19.27.gz", browser_download_url: "arm-go120-url" },
      { name: "mihomo-darwin-arm64-go124-v1.19.27.gz", browser_download_url: "arm-go124-url" },
      { name: "mihomo-darwin-arm64-v1.19.27.gz", browser_download_url: "arm-url" }
    ]
  };

  assert.deepEqual(selectMihomoReleaseAsset(release, { platform: "darwin", arch: "arm64" }), {
    version: "v1.19.27",
    name: "mihomo-darwin-arm64-v1.19.27.gz",
    url: "arm-url"
  });
});

test("buildEmbeddedMihomoConfig writes controller, provider and listener config", () => {
  const text = buildEmbeddedMihomoConfig({
    controllerUrl: "http://127.0.0.1:19090",
    secret: "abc",
    subscriptionUrl: "https://example.com/sub.yaml"
  }, [
    { label: "tk-us", proxyUrl: "http://127.0.0.1:18101", nodeName: "[HY2]美国001" }
  ]);

  assert.match(text, /external-controller: 127\.0\.0\.1:19090/);
  assert.match(text, /secret: "abc"/);
  assert.match(text, /url: "https:\/\/example\.com\/sub\.yaml"/);
  assert.match(text, /name: "tk-us"/);
  assert.match(text, /port: 18101/);
  assert.match(text, /proxy: "\[HY2\]美国001"/);
  assert.doesNotMatch(text, /^mixed-port:/m);
});

test("buildEmbeddedMihomoConfig requires a subscription URL", () => {
  assert.throws(
    () => buildEmbeddedMihomoConfig({ controllerUrl: "http://127.0.0.1:19090" }, []),
    /订阅地址/
  );
});

test("installEmbeddedMihomo downloads gz asset and writes executable binary", async () => {
  const home = mkdtempSync(join(tmpdir(), "md-browser-embedded-install-"));
  const binaryBytes = Buffer.from("#!/bin/sh\necho mihomo\n");
  const calls = [];
  try {
    const fetchImpl = async (url) => {
      calls.push(url);
      if (url.includes("/repos/MetaCubeX/mihomo/releases/latest")) {
        return {
          ok: true,
          json: async () => ({
            tag_name: "v1.19.27",
            assets: [
              {
                name: "mihomo-darwin-arm64-v1.19.27.gz",
                browser_download_url: "https://download.test/mihomo.gz"
              }
            ]
          })
        };
      }
      const gzipped = gzipSync(binaryBytes);
      return {
        ok: true,
        arrayBuffer: async () => gzipped.buffer.slice(gzipped.byteOffset, gzipped.byteOffset + gzipped.byteLength)
      };
    };

    const result = await installEmbeddedMihomo({
      binaryPath: "~/Library/Application Support/MD-Browser/bin/mihomo"
    }, { homeDir: home, fetchImpl });

    assert.equal(result.installed, true);
    assert.equal(result.asset.name, "mihomo-darwin-arm64-v1.19.27.gz");
    assert.equal(readFileSync(result.binaryPath, "utf8"), binaryBytes.toString("utf8"));
    assert.equal(statSync(result.binaryPath).mode & 0o111, 0o111);
    assert.deepEqual(calls, [
      "https://api.github.com/repos/MetaCubeX/mihomo/releases/latest",
      "https://download.test/mihomo.gz"
    ]);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("embeddedMihomoStatus reports installed and running state from files", async () => {
  const home = mkdtempSync(join(tmpdir(), "md-browser-embedded-"));
  try {
    const binary = join(home, "bin/mihomo");
    const config = join(home, "mihomo/config.yaml");
    const pid = join(home, "mihomo/mihomo.pid");
    mkdirSync(join(home, "bin"), { recursive: true });
    mkdirSync(join(home, "mihomo"), { recursive: true });
    writeFileSync(binary, "");
    writeFileSync(config, "mode: rule\n");
    writeFileSync(pid, String(process.pid));

    const status = await embeddedMihomoStatus({
      binaryPath: binary,
      configPath: config,
      controllerUrl: "http://127.0.0.1:19090",
      secret: ""
    }, { homeDir: home, fetchImpl: async () => ({ ok: true, json: async () => ({ version: "1.0.0" }) }) });

    assert.equal(status.installed, true);
    assert.equal(status.configExists, true);
    assert.equal(status.processRunning, true);
    assert.equal(status.apiConnected, true);
    assert.equal(status.version, "1.0.0");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("embeddedMihomoStatus clears stale pid files", async () => {
  const home = mkdtempSync(join(tmpdir(), "md-browser-embedded-stale-"));
  try {
    const binary = join(home, "bin/mihomo");
    const config = join(home, "mihomo/config.yaml");
    const pid = join(home, "mihomo/mihomo.pid");
    mkdirSync(join(home, "bin"), { recursive: true });
    mkdirSync(join(home, "mihomo"), { recursive: true });
    writeFileSync(binary, "");
    writeFileSync(config, "mode: rule\n");
    writeFileSync(pid, "999999");

    const status = await embeddedMihomoStatus({
      binaryPath: binary,
      configPath: config,
      controllerUrl: "http://127.0.0.1:19090",
      secret: ""
    }, {
      homeDir: home,
      fetchImpl: async () => ({ ok: false, json: async () => ({}) }),
      isProcessRunningImpl: () => false
    });

    assert.equal(status.processRunning, false);
    assert.equal(status.stalePidCleared, true);
    assert.equal(existsSync(pid), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("startEmbeddedMihomo requires installed core and subscription URL", () => {
  const home = mkdtempSync(join(tmpdir(), "md-browser-embedded-start-"));
  try {
    assert.throws(
      () => startEmbeddedMihomo({
        binaryPath: "~/bin/mihomo",
        configPath: "~/mihomo/config.yaml",
        subscriptionUrl: "https://example.com/sub.yaml"
      }, { homeDir: home }),
      /Core 尚未安装/
    );

    mkdirSync(join(home, "bin"), { recursive: true });
    writeFileSync(join(home, "bin/mihomo"), "");
    assert.throws(
      () => startEmbeddedMihomo({
        binaryPath: "~/bin/mihomo",
        configPath: "~/mihomo/config.yaml"
      }, { homeDir: home }),
      /订阅地址/
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("startEmbeddedMihomo writes config and pid file with injected spawner", () => {
  const home = mkdtempSync(join(tmpdir(), "md-browser-embedded-start-"));
  try {
    mkdirSync(join(home, "bin"), { recursive: true });
    writeFileSync(join(home, "bin/mihomo"), "");
    const calls = [];
    const result = startEmbeddedMihomo({
      binaryPath: "~/bin/mihomo",
      configPath: "~/mihomo/config.yaml",
      controllerUrl: "http://127.0.0.1:19090",
      subscriptionUrl: "https://example.com/sub.yaml"
    }, {
      homeDir: home,
      routes: [{ label: "tk-us", proxyUrl: "http://127.0.0.1:18101", nodeName: "US-Node" }],
      spawnImpl: (binary, args, options) => {
        calls.push({ binary, args, options });
        return { pid: 12345, unref() {} };
      }
    });

    assert.equal(result.started, true);
    assert.equal(result.pid, 12345);
    assert.equal(readFileSync(join(home, "mihomo/mihomo.pid"), "utf8"), "12345");
    assert.match(readFileSync(join(home, "mihomo/config.yaml"), "utf8"), /proxy: "US-Node"/);
    assert.equal(calls[0].binary, join(home, "bin/mihomo"));
    assert.deepEqual(calls[0].args, ["-f", join(home, "mihomo/config.yaml")]);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("startEmbeddedMihomo returns existing process without spawning again", () => {
  const home = mkdtempSync(join(tmpdir(), "md-browser-embedded-already-running-"));
  try {
    mkdirSync(join(home, "bin"), { recursive: true });
    mkdirSync(join(home, "mihomo"), { recursive: true });
    writeFileSync(join(home, "bin/mihomo"), "");
    writeFileSync(join(home, "mihomo/mihomo.pid"), "12345");
    writeFileSync(join(home, "mihomo/config.yaml"), "existing-config");

    const result = startEmbeddedMihomo({
      binaryPath: "~/bin/mihomo",
      configPath: "~/mihomo/config.yaml",
      subscriptionUrl: "https://example.com/sub.yaml"
    }, {
      homeDir: home,
      isProcessRunningImpl: () => true,
      spawnImpl: () => {
        throw new Error("should not spawn");
      }
    });

    assert.equal(result.started, false);
    assert.equal(result.alreadyRunning, true);
    assert.equal(result.pid, 12345);
    assert.equal(readFileSync(join(home, "mihomo/config.yaml"), "utf8"), "existing-config");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("stopEmbeddedMihomo removes pid file after stopping", () => {
  const home = mkdtempSync(join(tmpdir(), "md-browser-embedded-stop-"));
  try {
    mkdirSync(join(home, "mihomo"), { recursive: true });
    const pidPath = join(home, "mihomo/mihomo.pid");
    writeFileSync(pidPath, "12345");
    const killed = [];

    const result = stopEmbeddedMihomo({
      configPath: "~/mihomo/config.yaml"
    }, {
      homeDir: home,
      killImpl: (pid) => killed.push(pid)
    });

    assert.equal(result.stopped, true);
    assert.deepEqual(killed, [12345]);
    assert.equal(existsSync(pidPath), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
