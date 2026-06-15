import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  addUserDataRoot,
  configPath,
  createRoute,
  deleteRoute,
  loadConfig,
  removeUserDataRoot,
  saveConfig,
  updateRoute,
  updateSystemSettings
} from "../src/config.js";

test("loadConfig creates an empty route config in empty home", () => {
  const dir = mkdtempSync(join(tmpdir(), "tk-router-"));
  try {
    const config = loadConfig({ homeDir: dir });
    assert.deepEqual(config.routes, {});
    assert.deepEqual(config.userDataRoots, []);
    assert.equal(config.profileRoot, "~/Library/Application Support/MD-Browser/Profiles");
    assert.equal(config.proxyClient.mode, "external");
    assert.equal(config.agent.mcpEnabled, true);
    assert.equal(config.embeddedMihomo.controllerUrl, "http://127.0.0.1:19090");
    assert.equal(config.embeddedMihomo.binaryPath, "~/Library/Application Support/MD-Browser/bin/mihomo");
    assert.equal(config.embeddedMihomo.configPath, "~/Library/Application Support/MD-Browser/mihomo/config.yaml");
    assert.equal(configPath({ homeDir: dir }), join(dir, ".md-browser/config.json"));
    assert.equal(existsSync(join(dir, ".md-browser/config.json")), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadConfig migrates legacy tk-browser-router config to MD-Browser path", () => {
  const dir = mkdtempSync(join(tmpdir(), "tk-router-"));
  try {
    const legacyPath = join(dir, ".tk-browser-router/config.json");
    mkdirSync(join(dir, ".tk-browser-router"), { recursive: true });
    writeFileSync(legacyPath, `${JSON.stringify({
      version: 1,
      proxyClient: { mode: "external" },
      userDataRoots: [
        "/Users/example/Library/Application Support/Google/Chrome",
        "~/Library/Application Support/MD-Browser/Profiles"
      ],
      mihomo: {
        controllerUrl: "http://127.0.0.1:9097",
        mergePath: "~/Library/Application Support/io.github.clash-verge-rev.clash-verge-rev/profiles/Merge.yaml",
        runtimePath: ""
      },
      routes: {
        old: {
          label: "Legacy Route",
          cdpPort: 9222,
          proxyUrl: "http://127.0.0.1:18101"
        },
        chrome: {
          label: "Default Chrome",
          cdpPort: 9223,
          proxyUrl: "http://127.0.0.1:18102",
          userDataDir: "/Users/example/Library/Application Support/Google/Chrome",
          profileDirectory: "Default"
        }
      }
    }, null, 2)}\n`);

    const config = loadConfig({ homeDir: dir, now: new Date(2026, 5, 12, 7, 8, 9) });
    const migratedPath = join(dir, ".md-browser/config.json");
    const backupPath = join(dir, ".tk-browser-router/config.legacy-backup.20260612070809.json");

    assert.equal(config.routes.old.label, "Legacy Route");
    assert.equal(config.routes.chrome, undefined);
    assert.deepEqual(config.userDataRoots, ["~/Library/Application Support/MD-Browser/Profiles"]);
    assert.equal(
      config.mihomo.runtimePath,
      "~/Library/Application Support/io.github.clash-verge-rev.clash-verge-rev/clash-verge.yaml"
    );
    assert.equal(existsSync(migratedPath), true);
    assert.equal(JSON.parse(readFileSync(migratedPath, "utf8")).routes.old.label, "Legacy Route");
    assert.equal(existsSync(legacyPath), true);
    assert.equal(existsSync(backupPath), true);
    assert.equal(JSON.parse(readFileSync(backupPath, "utf8")).routes.old.label, "Legacy Route");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("user-data roots can be added and removed", () => {
  const dir = mkdtempSync(join(tmpdir(), "tk-router-"));
  try {
    let config = loadConfig({ homeDir: dir });
    assert.deepEqual(config.userDataRoots, []);

    addUserDataRoot("~/CustomChromeProfiles", { homeDir: dir });
    config = loadConfig({ homeDir: dir });
    assert.ok(config.userDataRoots.includes("~/CustomChromeProfiles"));

    removeUserDataRoot("~/CustomChromeProfiles", { homeDir: dir });
    config = loadConfig({ homeDir: dir });
    assert.equal(config.userDataRoots.includes("~/CustomChromeProfiles"), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadConfig filters the system default Chrome user data root", () => {
  const dir = mkdtempSync(join(tmpdir(), "tk-router-"));
  try {
    saveConfig({
      ...loadConfig({ homeDir: dir }),
      userDataRoots: [
        "/Users/example/Library/Application Support/Google/Chrome",
        "~/Library/Application Support/MD-Browser/Profiles"
      ]
    }, { homeDir: dir });

    const config = loadConfig({ homeDir: dir });
    assert.deepEqual(config.userDataRoots, ["~/Library/Application Support/MD-Browser/Profiles"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("addUserDataRoot rejects the system default Chrome user data root", () => {
  const dir = mkdtempSync(join(tmpdir(), "tk-router-"));
  try {
    assert.throws(
      () => addUserDataRoot("/Users/example/Library/Application Support/Google/Chrome", { homeDir: dir }),
      /不能导入系统默认 Chrome 资料目录/
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("system settings can be updated", () => {
  const dir = mkdtempSync(join(tmpdir(), "tk-router-"));
  try {
    updateSystemSettings({
      chromeAppName: "Google Chrome Beta",
      profileRoot: "~/Profiles",
      proxyClient: { mode: "embedded" },
      agent: { mcpEnabled: false },
      server: { host: "127.0.0.1", port: 18888 },
      mihomo: {
        controllerUrl: "http://127.0.0.1:9097/",
        secret: "sample-token",
        mergePath: "~/Merge.yaml",
        runtimePath: "~/clash-verge.yaml"
      },
      embeddedMihomo: {
        controllerUrl: "http://127.0.0.1:19090/",
        secret: "sample-embedded-token",
        binaryPath: "~/bin/mihomo",
        configPath: "~/mihomo/config.yaml",
        subscriptionUrl: "https://example.com/sub",
        autoStart: true
      }
    }, { homeDir: dir });

    const config = loadConfig({ homeDir: dir });
    assert.equal(config.chromeAppName, "Google Chrome Beta");
    assert.equal(config.profileRoot, "~/Profiles");
    assert.equal(config.proxyClient.mode, "embedded");
    assert.equal(config.agent.mcpEnabled, false);
    assert.equal(config.server.port, 18888);
    assert.equal(config.mihomo.controllerUrl, "http://127.0.0.1:9097");
    assert.equal(config.mihomo.secret, "sample-token");
    assert.equal(config.mihomo.mergePath, "~/Merge.yaml");
    assert.equal(config.mihomo.runtimePath, "~/clash-verge.yaml");
    assert.equal(config.embeddedMihomo.controllerUrl, "http://127.0.0.1:19090");
    assert.equal(config.embeddedMihomo.secret, "sample-embedded-token");
    assert.equal(config.embeddedMihomo.binaryPath, "~/bin/mihomo");
    assert.equal(config.embeddedMihomo.configPath, "~/mihomo/config.yaml");
    assert.equal(config.embeddedMihomo.subscriptionUrl, "https://example.com/sub");
    assert.equal(config.embeddedMihomo.autoStart, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("system settings can disable active proxy backend", () => {
  const dir = mkdtempSync(join(tmpdir(), "tk-router-"));
  try {
    const config = updateSystemSettings({
      proxyClient: { mode: "none" }
    }, { homeDir: dir });

    assert.equal(config.proxyClient.mode, "none");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("embedded Mihomo subscription URL must be http or https", () => {
  const dir = mkdtempSync(join(tmpdir(), "tk-router-"));
  try {
    assert.throws(
      () => updateSystemSettings({
        embeddedMihomo: {
          subscriptionUrl: "not a url"
        }
      }, { homeDir: dir }),
      /请输入有效的内置 Mihomo 订阅地址/
    );
    assert.throws(
      () => updateSystemSettings({
        embeddedMihomo: {
          subscriptionUrl: "file:///Users/me/sub.yaml"
        }
      }, { homeDir: dir }),
      /订阅地址必须是 http 或 https/
    );
    assert.throws(
      () => updateSystemSettings({
        embeddedMihomo: {
          subscriptionUrl: "ftp://example.com/sub"
        }
      }, { homeDir: dir }),
      /订阅地址必须是 http 或 https/
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("updateRoute persists editable route fields", () => {
  const dir = mkdtempSync(join(tmpdir(), "tk-router-"));
  try {
    const created = createRoute({
      label: "Example Site US",
      cdpPort: 9222,
      proxyUrl: "http://127.0.0.1:18101"
    }, { homeDir: dir });
    updateRoute(
      created.routeKey,
      { proxyUrl: "http://127.0.0.1:19101", mihomoGroup: "US-A" },
      { homeDir: dir }
    );
    const config = loadConfig({ homeDir: dir });
    assert.equal(config.routes[created.routeKey].proxyUrl, "http://127.0.0.1:19101");
    assert.equal(config.routes[created.routeKey].mihomoGroup, "US-A");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("updateRoute preserves an empty start URL", () => {
  const dir = mkdtempSync(join(tmpdir(), "tk-router-"));
  try {
    const created = createRoute({
      label: "Example Site UK",
      cdpPort: 9225,
      proxyUrl: "http://127.0.0.1:18104"
    }, { homeDir: dir });
    updateRoute(created.routeKey, { startUrl: "" }, { homeDir: dir });
    const config = loadConfig({ homeDir: dir });
    assert.equal(config.routes[created.routeKey].startUrl, "");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("createRoute adds a user named browser environment", () => {
  const dir = mkdtempSync(join(tmpdir(), "tk-router-"));
  try {
    const created = createRoute({
      label: "Content Workspace",
      cdpPort: 9333,
      proxyUrl: "http://127.0.0.1:18333",
      userDataDir: "/Users/example/BrowserProfiles/Content",
      profileDirectory: "Default",
      startUrl: "https://example.com/content",
      tags: ["Content", "workspace"]
    }, { homeDir: dir });
    assert.equal(created.routeKey, "content-workspace");
    assert.equal(created.config.routes["content-workspace"].cdpPort, 9333);
    assert.deepEqual(created.config.routes["content-workspace"].tags, ["Content", "workspace"]);
    assert.equal("shortLabel" in created.config.routes["content-workspace"], false);
    assert.equal("accent" in created.config.routes["content-workspace"], false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("createRoute assigns a managed user data dir when none is selected", () => {
  const dir = mkdtempSync(join(tmpdir(), "tk-router-"));
  try {
    const created = createRoute({
      label: "客户 A / Example Site",
      cdpPort: 9555,
      proxyUrl: "http://127.0.0.1:18555"
    }, { homeDir: dir });
    const route = created.config.routes[created.routeKey];
    assert.equal(route.userDataDir, "~/Library/Application Support/MD-Browser/Profiles/客户 A - Example Site");
    assert.equal(route.profileName, "客户 A - Example Site");
    assert.equal(route.profileDirectory, "Default");
    assert.equal(
      existsSync(join(dir, "Library/Application Support/MD-Browser/Profiles/客户 A - Example Site/Default")),
      true
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("createRoute uses the configured profileRoot for managed identities", () => {
  const dir = mkdtempSync(join(tmpdir(), "tk-router-"));
  try {
    saveConfig({
      version: 1,
      server: { host: "127.0.0.1", port: 18777 },
      profileRoot: "~/CustomProfiles",
      userDataRoots: [],
      chromeAppName: "Google Chrome",
      proxyClient: { mode: "external" },
      agent: { mcpEnabled: true },
      mihomo: {},
      embeddedMihomo: {},
      routes: {}
    }, { homeDir: dir });

    const created = createRoute({
      label: "Custom Root Route",
      cdpPort: 9556,
      proxyUrl: "http://127.0.0.1:18556"
    }, { homeDir: dir });

    const route = created.config.routes[created.routeKey];
    assert.equal(route.userDataDir, "~/CustomProfiles/Custom Root Route");
    assert.equal(existsSync(join(dir, "CustomProfiles/Custom Root Route/Default")), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("updateRoute replaces an existing user data dir with a managed identity when requested", () => {
  const dir = mkdtempSync(join(tmpdir(), "tk-router-"));
  try {
    saveConfig({
      version: 1,
      server: { host: "127.0.0.1", port: 18777 },
      profileRoot: "~/Library/Application Support/MD-Browser/Profiles",
      userDataRoots: [],
      chromeAppName: "Google Chrome",
      proxyClient: { mode: "external" },
      agent: { mcpEnabled: true },
      mihomo: {},
      embeddedMihomo: {},
      routes: {
        test: {
          label: "test",
          cdpPort: 9222,
          proxyUrl: "http://127.0.0.1:18101",
          profileName: "Chrome",
          userDataDir: "/Users/example/Library/Application Support/Google/Chrome",
          profileDirectory: "Default"
        }
      }
    }, { homeDir: dir });

    const config = updateRoute("test", {
      label: "test",
      cdpPort: 9222,
      proxyUrl: "http://127.0.0.1:18101",
      profileName: "test",
      userDataDir: "",
      profileDirectory: "Default"
    }, { homeDir: dir });

    const route = config.routes.test;
    assert.equal(route.userDataDir, "~/Library/Application Support/MD-Browser/Profiles/test");
    assert.equal(route.profileDirectory, "Default");
    assert.equal(
      existsSync(join(dir, "Library/Application Support/MD-Browser/Profiles/test/Default")),
      true
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("updateRoute uses the configured profileRoot when switching back to a managed identity", () => {
  const dir = mkdtempSync(join(tmpdir(), "tk-router-"));
  try {
    saveConfig({
      version: 1,
      server: { host: "127.0.0.1", port: 18777 },
      profileRoot: "~/CustomProfiles",
      userDataRoots: [],
      chromeAppName: "Google Chrome",
      proxyClient: { mode: "external" },
      agent: { mcpEnabled: true },
      mihomo: {},
      embeddedMihomo: {},
      routes: {
        test: {
          label: "Custom Root Route",
          cdpPort: 9556,
          proxyUrl: "http://127.0.0.1:18556",
          profileName: "Legacy",
          userDataDir: "/Users/example/BrowserProfiles/Legacy",
          profileDirectory: "Default"
        }
      }
    }, { homeDir: dir });

    const config = updateRoute("test", {
      userDataDir: "",
      profileName: "Custom Root Route",
      profileDirectory: "Default"
    }, { homeDir: dir });

    assert.equal(config.routes.test.userDataDir, "~/CustomProfiles/Custom Root Route");
    assert.equal(existsSync(join(dir, "CustomProfiles/Custom Root Route/Default")), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadConfig migrates legacy default Chrome route identities to managed identities in memory", () => {
  const dir = mkdtempSync(join(tmpdir(), "tk-router-"));
  try {
    saveConfig({
      version: 1,
      server: { host: "127.0.0.1", port: 18777 },
      profileRoot: "~/Library/Application Support/MD-Browser/Profiles",
      userDataRoots: [],
      chromeAppName: "Google Chrome",
      proxyClient: { mode: "external" },
      agent: { mcpEnabled: true },
      mihomo: {},
      embeddedMihomo: {},
      routes: {
        test: {
          label: "test",
          cdpPort: 9222,
          proxyUrl: "http://127.0.0.1:18101",
          profileName: "Chrome",
          userDataDir: "/Users/example/Library/Application Support/Google/Chrome",
          profileDirectory: "Default"
        }
      }
    }, { homeDir: dir });

    const config = loadConfig({ homeDir: dir });
    assert.equal(config.routes.test.userDataDir, undefined);
    assert.equal(config.routes.test.profileName, "Chrome");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("createRoute rejects the system default Chrome user data dir", () => {
  const dir = mkdtempSync(join(tmpdir(), "tk-router-"));
  try {
    assert.throws(
      () => createRoute({
        label: "Default Chrome",
        cdpPort: 9666,
        proxyUrl: "http://127.0.0.1:18666",
        userDataDir: "/Users/example/Library/Application Support/Google/Chrome",
        profileDirectory: "Default"
      }, { homeDir: dir }),
      /不能使用系统默认 Chrome 资料目录/
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("route ports must be unique", () => {
  const dir = mkdtempSync(join(tmpdir(), "tk-router-"));
  try {
    createRoute({
      label: "Base",
      cdpPort: 9222,
      proxyUrl: "http://127.0.0.1:18101"
    }, { homeDir: dir });
    assert.throws(
      () => createRoute({
        label: "Duplicate CDP",
        cdpPort: 9222,
        proxyUrl: "http://127.0.0.1:18333"
      }, { homeDir: dir }),
      /CDP port 9222 is already used/
    );
    assert.throws(
      () => createRoute({
        label: "Duplicate Proxy",
        cdpPort: 9333,
        proxyUrl: "http://127.0.0.1:18101"
      }, { homeDir: dir }),
      /Proxy port 18101 is already used/
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("deleteRoute removes user environments", () => {
  const dir = mkdtempSync(join(tmpdir(), "tk-router-"));
  try {
    const created = createRoute({
      label: "客户A测试环境",
      cdpPort: 9444,
      proxyUrl: "http://127.0.0.1:18444"
    }, { homeDir: dir });
    const key = created.routeKey;
    const config = deleteRoute(key, { homeDir: dir });
    assert.equal(Boolean(config.routes[key]), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadConfig preserves an intentionally empty route list", () => {
  const dir = mkdtempSync(join(tmpdir(), "tk-router-"));
  try {
    let config = loadConfig({ homeDir: dir });
    for (const key of Object.keys(config.routes)) {
      deleteRoute(key, { homeDir: dir });
    }

    config = loadConfig({ homeDir: dir });
    assert.deepEqual(config.routes, {});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("updateRoute rejects unknown route keys", () => {
  const dir = mkdtempSync(join(tmpdir(), "tk-router-"));
  try {
    assert.throws(
      () => updateRoute("tk-missing", { cdpPort: 9333 }, { homeDir: dir }),
      /Unknown route/
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
