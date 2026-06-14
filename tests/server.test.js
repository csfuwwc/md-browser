import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { autoRepairLaunchRoute, createAppServer, appInfo, enableEmbeddedMihomo, launchRouteAndConfirm, maybeAutoStartEmbeddedMihomo, repairEmbeddedMihomo, safeReloadConfig } from "../src/server.js";
import { defaultConfig, loadConfig, saveConfig } from "../src/config.js";

test("appInfo reads package metadata for version display", () => {
  const dir = mkdtempSync(join(tmpdir(), "md-browser-app-info-"));
  try {
    const packagePath = join(dir, "package.json");
    writeFileSync(packagePath, JSON.stringify({
      name: "md-browser",
      version: "0.2.3",
      description: "Local browser routing",
      build: {
        productName: "MD-Browser"
      }
    }));

    assert.deepEqual(appInfo({ packagePath }), {
      name: "md-browser",
      productName: "MD-Browser",
      version: "0.2.3",
      description: "Local browser routing"
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("appInfo falls back to MD-Browser product name in packaged app", () => {
  const dir = mkdtempSync(join(tmpdir(), "md-browser-packaged-app-info-"));
  try {
    const packagePath = join(dir, "package.json");
    writeFileSync(packagePath, JSON.stringify({
      name: "md-browser",
      version: "0.1.0",
      description: "Local browser routing"
    }));

    assert.deepEqual(appInfo({ packagePath }), {
      name: "md-browser",
      productName: "MD-Browser",
      version: "0.1.0",
      description: "Local browser routing"
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("agent node delay endpoint is blocked when MCP channel is disabled", async () => {
  const dir = mkdtempSync(join(tmpdir(), "md-browser-agent-disabled-"));
  const previousHome = process.env.HOME;
  let server;
  try {
    process.env.HOME = dir;
    saveConfig({
      ...defaultConfig,
      agent: { mcpEnabled: false },
      routes: {
        test: {
          label: "Test",
          cdpPort: 9222,
          proxyUrl: "http://127.0.0.1:18101",
          userDataDir: "~/Library/Application Support/MD-Browser/Profiles/Test",
          profileDirectory: "Default"
        }
      }
    }, { homeDir: dir });

    server = await listenOnRandomPort(createAppServer());
    const response = await fetch(`${server.url}/api/agent/routes/test/node-delay`, { method: "POST" });
    const body = await response.json();

    assert.equal(response.status, 403);
    assert.match(body.error, /Agent 通道已关闭/);
  } finally {
    if (server) await server.close();
    restoreHome(previousHome);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("HTTP MCP endpoint is blocked when MCP channel is disabled", async () => {
  const dir = mkdtempSync(join(tmpdir(), "md-browser-http-mcp-disabled-"));
  const previousHome = process.env.HOME;
  let server;
  try {
    process.env.HOME = dir;
    saveConfig({
      ...defaultConfig,
      agent: { mcpEnabled: false },
      routes: {}
    }, { homeDir: dir });

    server = await listenOnRandomPort(createAppServer());
    const response = await fetch(`${server.url}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })
    });
    const body = await response.json();

    assert.equal(response.status, 403);
    assert.equal(body.error.code, -32000);
    assert.match(body.error.message, /Agent 通道已关闭/);
  } finally {
    if (server) await server.close();
    restoreHome(previousHome);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("HTTP MCP endpoint initializes and lists tools", async () => {
  const dir = mkdtempSync(join(tmpdir(), "md-browser-http-mcp-"));
  const previousHome = process.env.HOME;
  let server;
  try {
    process.env.HOME = dir;
    saveConfig({
      ...defaultConfig,
      agent: { mcpEnabled: true },
      routes: {}
    }, { homeDir: dir });

    server = await listenOnRandomPort(createAppServer());
    const initResponse = await fetch(`${server.url}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } })
    });
    const initBody = await initResponse.json();
    const toolsResponse = await fetch(`${server.url}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" })
    });
    const toolsBody = await toolsResponse.json();

    assert.equal(initResponse.status, 200);
    assert.equal(initBody.result.serverInfo.name, "md-browser");
    assert.equal(toolsResponse.status, 200);
    assert.ok(toolsBody.result.tools.some((tool) => tool.name === "list_browser_configs"));
    assert.ok(toolsBody.result.tools.some((tool) => tool.name === "open_url_in_config"));
  } finally {
    if (server) await server.close();
    restoreHome(previousHome);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("agent node delay endpoint preserves not found status when enabled", async () => {
  const dir = mkdtempSync(join(tmpdir(), "md-browser-agent-node-delay-"));
  const previousHome = process.env.HOME;
  let server;
  try {
    process.env.HOME = dir;
    saveConfig({
      ...defaultConfig,
      agent: { mcpEnabled: true },
      routes: {}
    }, { homeDir: dir });

    server = await listenOnRandomPort(createAppServer());
    const response = await fetch(`${server.url}/api/agent/routes/missing/node-delay`, { method: "POST" });
    const body = await response.json();

    assert.equal(response.status, 404);
    assert.equal(body.error, "Unknown route: missing");
  } finally {
    if (server) await server.close();
    restoreHome(previousHome);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("diagnostics endpoint exposes local support paths", async () => {
  const dir = mkdtempSync(join(tmpdir(), "md-browser-diagnostics-"));
  const previousHome = process.env.HOME;
  let server;
  try {
    process.env.HOME = dir;
    saveConfig({
      ...defaultConfig,
      embeddedMihomo: {
        ...defaultConfig.embeddedMihomo,
        binaryPath: "~/Library/Application Support/MD-Browser/bin/mihomo",
        configPath: "~/Library/Application Support/MD-Browser/mihomo/config.yaml"
      },
      routes: {}
    }, { homeDir: dir });

    server = await listenOnRandomPort(createAppServer());
    const response = await fetch(`${server.url}/api/diagnostics`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.app.productName, "MD-Browser");
    assert.equal(body.configPath, join(dir, ".md-browser/config.json"));
    assert.equal(body.legacyConfigPath, join(dir, ".tk-browser-router/config.json"));
    assert.equal(body.scriptLogPath, join(dir, ".md-browser/webui.log"));
    assert.equal(body.embeddedMihomo.binaryPath, join(dir, "Library/Application Support/MD-Browser/bin/mihomo"));
    assert.equal(body.embeddedMihomo.configPath, join(dir, "Library/Application Support/MD-Browser/mihomo/config.yaml"));
  } finally {
    if (server) await server.close();
    restoreHome(previousHome);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("autoRepairLaunchRoute keeps the configured CDP port when it can launch safely", async () => {
  const dir = mkdtempSync(join(tmpdir(), "md-browser-auto-repair-launch-"));
  const previousHome = process.env.HOME;
  try {
    process.env.HOME = dir;
    saveConfig({
      ...defaultConfig,
      routes: {
        test: {
          label: "test",
          cdpPort: 9222,
          proxyUrl: "http://127.0.0.1:18101",
          userDataDir: join(dir, "profile"),
          profileDirectory: "Default"
        }
      }
    }, { homeDir: dir });

    const result = await autoRepairLaunchRoute("test", loadConfig({ homeDir: dir }), {
      homeDir: dir,
      isTcpListeningImpl: async () => false,
      fetchCdpVersionImpl: async () => null,
      launchRouteImpl: async (key, config) => ({ alreadyRunning: false, cdpPort: config.routes[key].cdpPort })
    });

    assert.equal(result.cdpPort, 9222);
    assert.equal(result.repaired, true);
    assert.equal(result.portChanged, false);
    assert.equal(loadConfig({ homeDir: dir }).routes.test.cdpPort, 9222);
  } finally {
    restoreHome(previousHome);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("autoRepairLaunchRoute fails instead of changing CDP port when the configured port cannot be released", async () => {
  const dir = mkdtempSync(join(tmpdir(), "md-browser-auto-repair-launch-stuck-"));
  const previousHome = process.env.HOME;
  try {
    process.env.HOME = dir;
    saveConfig({
      ...defaultConfig,
      routes: {
        test: {
          label: "test",
          cdpPort: 9222,
          proxyUrl: "http://127.0.0.1:18101",
          userDataDir: join(dir, "profile"),
          profileDirectory: "Default"
        }
      }
    }, { homeDir: dir });

    await assert.rejects(
      autoRepairLaunchRoute("test", loadConfig({ homeDir: dir }), {
        homeDir: dir,
        isTcpListeningImpl: async () => true,
        fetchCdpVersionImpl: async () => null,
        launchRouteImpl: async () => {
          throw new Error("should not launch while port is occupied");
        }
      }),
      /指定 CDP 端口 9222 仍被占用/
    );
    assert.equal(loadConfig({ homeDir: dir }).routes.test.cdpPort, 9222);
  } finally {
    restoreHome(previousHome);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("launchRouteAndConfirm waits until CDP is actually readable", async () => {
  const config = {
    routes: {
      test: {
        label: "test",
        cdpPort: 9222
      }
    }
  };
  let checks = 0;
  const result = await launchRouteAndConfirm("test", config, {
    launchRouteImpl: async () => ({ alreadyRunning: false, cdpPort: 9222 }),
    isTcpListeningImpl: async () => true,
    fetchCdpVersionImpl: async () => {
      checks += 1;
      return checks >= 2 ? { Browser: "Chrome/148" } : null;
    },
    timeoutMs: 1000
  });

  assert.equal(result.cdpReady, true);
  assert.deepEqual(result.cdpVersion, { Browser: "Chrome/148" });
});

test("launchRouteAndConfirm does not repair a non-CDP port conflict automatically", async () => {
  const config = {
    routes: {
      test: {
        label: "test",
        cdpPort: 9222
      }
    }
  };
  const conflict = new Error("conflict");
  conflict.code = "CDP_PORT_CONFLICT";

  await assert.rejects(
    launchRouteAndConfirm("test", config, {
      launchRouteImpl: async () => {
        throw conflict;
      },
      isTcpListeningImpl: async () => true,
      fetchCdpVersionImpl: async () => ({ Browser: "Chrome/148" }),
      timeoutMs: 1000
    }),
    /conflict/
  );
});

test("maybeAutoStartEmbeddedMihomo skips external mode", () => {
  const calls = [];
  const result = maybeAutoStartEmbeddedMihomo({
    proxyClient: { mode: "external" },
    embeddedMihomo: { autoStart: true },
    routes: {}
  }, {
    startImpl: (...args) => calls.push(args)
  });

  assert.deepEqual(calls, []);
  assert.deepEqual(result, { started: false, reason: "not-embedded-mode" });
});

test("maybeAutoStartEmbeddedMihomo skips embedded mode when autoStart is off", () => {
  const result = maybeAutoStartEmbeddedMihomo({
    proxyClient: { mode: "embedded" },
    embeddedMihomo: { autoStart: false },
    routes: {}
  }, {
    startImpl: () => {
      throw new Error("should not start");
    }
  });

  assert.deepEqual(result, { started: false, reason: "auto-start-disabled" });
});

test("maybeAutoStartEmbeddedMihomo starts embedded core with route entries", () => {
  const calls = [];
  const result = maybeAutoStartEmbeddedMihomo({
    proxyClient: { mode: "embedded" },
    embeddedMihomo: {
      autoStart: true,
      configPath: "~/missing-config.yaml"
    },
    routes: {
      us: {
        label: "US",
        cdpPort: 9222,
        proxyUrl: "http://127.0.0.1:18101"
      }
    }
  }, {
    startImpl: (config, options) => {
      calls.push({ config, options });
      return { started: true, pid: 12345 };
    }
  });

  assert.equal(result.started, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].config.autoStart, true);
  assert.equal(calls[0].options.routes[0].key, "us");
  assert.equal(calls[0].options.routes[0].proxyUrl, "http://127.0.0.1:18101");
});

test("safeReloadConfig returns reload errors without throwing", async () => {
  const result = await safeReloadConfig({ controllerUrl: "http://127.0.0.1:19090" }, {
    reloadImpl: async () => {
      throw new Error("connect ECONNREFUSED 127.0.0.1:19090");
    }
  });

  assert.equal(result.reloaded, false);
  assert.equal(result.error, "connect ECONNREFUSED 127.0.0.1:19090");
});

test("safeReloadConfig returns successful reload result", async () => {
  const result = await safeReloadConfig({ controllerUrl: "http://127.0.0.1:19090" }, {
    reloadImpl: async () => ({ reloaded: true })
  });

  assert.deepEqual(result, { reloaded: true });
});

test("enableEmbeddedMihomo installs missing core and starts embedded proxy", async () => {
  const calls = [];
  const result = await enableEmbeddedMihomo({
    embeddedMihomo: {
      controllerUrl: "http://127.0.0.1:19090",
      subscriptionUrl: "https://example.com/sub.yaml"
    },
    routes: {
      us: {
        label: "US",
        proxyUrl: "http://127.0.0.1:18101"
      }
    }
  }, {
    statusImpl: async () => ({ installed: false }),
    installImpl: async (config) => {
      calls.push(["install", config.subscriptionUrl]);
      return { installed: true, asset: { name: "mihomo-darwin-arm64.gz" }, binaryPath: "/tmp/mihomo" };
    },
    startImpl: (config, options) => {
      calls.push(["start", config.controllerUrl, options.routes[0].label]);
      return { started: true, pid: 12345, configPath: "/tmp/config.yaml" };
    }
  });

  assert.deepEqual(calls, [
    ["install", "https://example.com/sub.yaml"],
    ["start", "http://127.0.0.1:19090", "US"]
  ]);
  assert.equal(result.installedNow, true);
  assert.equal(result.started, true);
  assert.equal(result.start.pid, 12345);
});

test("enableEmbeddedMihomo requires subscription before installing core", async () => {
  await assert.rejects(
    () => enableEmbeddedMihomo({
      embeddedMihomo: {
        controllerUrl: "http://127.0.0.1:19090",
        subscriptionUrl: ""
      },
      routes: {}
    }, {
      statusImpl: async () => {
        throw new Error("should not check status");
      },
      installImpl: async () => {
        throw new Error("should not install");
      },
      startImpl: () => {
        throw new Error("should not start");
      }
    }),
    /订阅地址/
  );
});

test("enableEmbeddedMihomo skips install when core already exists", async () => {
  const calls = [];
  const result = await enableEmbeddedMihomo({
    embeddedMihomo: {
      controllerUrl: "http://127.0.0.1:19090",
      subscriptionUrl: "https://example.com/sub.yaml"
    },
    routes: {}
  }, {
    statusImpl: async () => ({ installed: true }),
    installImpl: async () => {
      throw new Error("should not install");
    },
    startImpl: () => {
      calls.push("start");
      return { started: false, alreadyRunning: true, pid: 12345 };
    }
  });

  assert.deepEqual(calls, ["start"]);
  assert.equal(result.installedNow, false);
  assert.equal(result.start.alreadyRunning, true);
});

test("repairEmbeddedMihomo leaves healthy embedded proxy untouched", async () => {
  const result = await repairEmbeddedMihomo({
    embeddedMihomo: {
      controllerUrl: "http://127.0.0.1:19090",
      subscriptionUrl: "https://example.com/sub.yaml"
    },
    routes: {}
  }, {
    statusImpl: async () => ({ installed: true, apiConnected: true }),
    installImpl: async () => {
      throw new Error("should not install");
    },
    stopImpl: () => {
      throw new Error("should not stop");
    },
    startImpl: () => {
      throw new Error("should not start");
    }
  });

  assert.equal(result.healthy, true);
  assert.equal(result.repaired, false);
  assert.deepEqual(result.actions, []);
});

test("repairEmbeddedMihomo restarts broken process and reinstalls after start failure", async () => {
  const calls = [];
  let startAttempts = 0;
  const result = await repairEmbeddedMihomo({
    embeddedMihomo: {
      controllerUrl: "http://127.0.0.1:19090",
      subscriptionUrl: "https://example.com/sub.yaml"
    },
    routes: {
      th: {
        label: "TH",
        proxyUrl: "http://127.0.0.1:18103"
      }
    }
  }, {
    statusImpl: async () => ({ installed: true, processRunning: true, apiConnected: false }),
    stopImpl: () => {
      calls.push("stop");
      return { stopped: true, pid: 456 };
    },
    installImpl: async () => {
      calls.push("install");
      return { installed: true, binaryPath: "/tmp/mihomo" };
    },
    startImpl: (_config, options) => {
      calls.push(["start", options.routes[0].label]);
      startAttempts += 1;
      if (startAttempts === 1) throw new Error("bad binary");
      return { started: true, pid: 789 };
    }
  });

  assert.deepEqual(calls, [
    "stop",
    ["start", "TH"],
    "install",
    ["start", "TH"]
  ]);
  assert.deepEqual(result.actions, ["restart", "reinstall", "start"]);
  assert.equal(result.started, true);
});

test("embedded enable endpoint switches active proxy mode to embedded", async () => {
  const dir = mkdtempSync(join(tmpdir(), "md-browser-embedded-api-"));
  const previousHome = process.env.HOME;
  let server;
  let pid = 0;
  try {
    process.env.HOME = dir;
    const binaryPath = join(dir, "bin/mihomo");
    mkdirSync(join(dir, "bin"), { recursive: true });
    writeFileSync(binaryPath, "#!/bin/sh\nsleep 30\n");
    chmodSync(binaryPath, 0o755);
    saveConfig({
      ...defaultConfig,
      proxyClient: { mode: "external" },
      embeddedMihomo: {
        ...defaultConfig.embeddedMihomo,
        binaryPath,
        configPath: join(dir, "mihomo/config.yaml"),
        subscriptionUrl: "https://example.com/sub.yaml"
      },
      routes: {
        us: {
          label: "US",
          cdpPort: 9222,
          proxyUrl: "http://127.0.0.1:18101"
        }
      }
    }, { homeDir: dir });

    server = await listenOnRandomPort(createAppServer());
    const response = await fetch(`${server.url}/api/embedded-mihomo/enable`, { method: "POST" });
    const body = await response.json();
    pid = body.start?.pid || 0;

    assert.equal(response.status, 200);
    assert.equal(loadConfig({ homeDir: dir }).proxyClient.mode, "embedded");
  } finally {
    if (pid) {
      try {
        process.kill(pid);
      } catch {}
    }
    if (server) await server.close();
    restoreHome(previousHome);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("mihomo nodes endpoint reports disabled proxy backend", async () => {
  const dir = mkdtempSync(join(tmpdir(), "md-browser-no-proxy-"));
  const previousHome = process.env.HOME;
  let server;
  try {
    process.env.HOME = dir;
    saveConfig({
      ...defaultConfig,
      proxyClient: { mode: "none" },
      routes: {}
    }, { homeDir: dir });

    server = await listenOnRandomPort(createAppServer());
    const response = await fetch(`${server.url}/api/mihomo/nodes`);
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.error, "未启动代理服务");
  } finally {
    if (server) await server.close();
    restoreHome(previousHome);
    rmSync(dir, { recursive: true, force: true });
  }
});

function listenOnRandomPort(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((closeResolve, closeReject) => {
          server.close((error) => error ? closeReject(error) : closeResolve());
        })
      });
    });
  });
}

function restoreHome(value) {
  if (value === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = value;
  }
}
