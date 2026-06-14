import { spawn } from "node:child_process";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import {
  expandHome,
  closeRouteBrowser,
  foregroundRouteWindow,
  foregroundChromeWindow,
  launchRoute,
  listChromiumBrowserCandidates,
  listImportableUserDataRootCandidates,
  listProfiles,
  listUserDataDirsForRoots,
  openUrlInRoute,
  profileDirectory,
  profileDir,
  userDataDir,
  userDataDirName
} from "./chrome.js";
import {
  addUserDataRoot,
  configPath,
  createRoute,
  deleteRoute,
  defaultConfig,
  legacyConfigPath,
  loadConfig,
  removeUserDataRoot,
  updateRoute,
  updateSystemSettings
} from "./config.js";
import { fetchCdpVersion, inspectTcpPort, isTcpListening, parseProxyPort } from "./ports.js";
import { deleteListenerByPort, listExternalProxyClientCandidates, listGroups, listNodes, readListenerProxy, reloadConfig, testNodeDelay, updateListenerProxyEverywhere } from "./mihomo.js";
import {
  embeddedMihomoStatus,
  embeddedMihomoPaths,
  installEmbeddedMihomo,
  startEmbeddedMihomo,
  stopEmbeddedMihomo,
  writeEmbeddedMihomoConfig
} from "./embedded-mihomo.js";
import { handleMcpMessage, mcpToolText } from "./mcp.js";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const webDir = join(rootDir, "web");
let runningServer;

function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(`${JSON.stringify(body, null, 2)}\n`);
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

async function routeStatus(config) {
  const mihomoConfig = activeMihomoConfig(config);
  const mergePath = activeMihomoMergePath(config);
  const nodeMap = await readNodeMap(mihomoConfig);
  const entries = await Promise.all(Object.entries(config.routes).map(async ([key, route]) => {
    const proxyPort = parseProxyPort(route.proxyUrl);
    const cdpListening = await isTcpListening(route.cdpPort);
    const cdpVersion = cdpListening ? await fetchCdpVersion(route.cdpPort) : null;
    const nodeName = readOptionalListenerProxy(mergePath, proxyPort);
    const nodeStatus = resolveNodeStatus(nodeName, nodeMap);
    const proxyListening = await isTcpListening(proxyPort);
    return [key, {
      ...route,
      key,
      profileDir: profileDir(config, route),
      userDataDir: userDataDir(config, route),
      userDataDirName: userDataDirName(config, route),
      profileDirectory: profileDirectory(route),
      proxyPort,
      nodeName,
      nodeStatus,
      cdpListening,
      cdpReady: Boolean(cdpVersion),
      proxyListening,
      cdpVersion
    }];
  }));
  return Object.fromEntries(entries);
}

async function readNodeMap(mihomoConfig) {
  if (!mihomoConfig) {
    return {
      available: false,
      error: "未启动代理服务",
      nodes: new Map()
    };
  }
  try {
    const { nodes } = await listNodes(mihomoConfig);
    return {
      available: true,
      nodes: new Map(nodes.map((node) => [node.name, node]))
    };
  } catch (error) {
    return {
      available: false,
      error: error.message,
      nodes: new Map()
    };
  }
}

function resolveNodeStatus(nodeName, nodeMap) {
  if (!nodeName) {
    return { state: "unbound", label: "未绑定节点", valid: false, alive: false };
  }
  if (!nodeMap.available) {
    return { state: "unknown", label: "节点池未连接", valid: false, alive: false, error: nodeMap.error };
  }
  const node = nodeMap.nodes.get(nodeName);
  if (!node) {
    return { state: "missing", label: "节点不存在", valid: false, alive: false };
  }
  if (node.alive === false) {
    return { state: "timeout", label: "节点不可用", valid: false, alive: false, type: node.type };
  }
  return { state: "ready", label: "节点可用", valid: true, alive: true, type: node.type };
}

function readOptionalListenerProxy(mergePath, proxyPort) {
  try {
    return readListenerProxy(mergePath, proxyPort);
  } catch {
    return "";
  }
}

function activeMihomoConfig(config) {
  if (config.proxyClient?.mode === "none") return null;
  return config.proxyClient?.mode === "embedded" ? config.embeddedMihomo : config.mihomo;
}

function activeMihomoMergePath(config) {
  const mihomoConfig = activeMihomoConfig(config);
  if (!mihomoConfig) return "";
  return expandHome(config.proxyClient?.mode === "embedded" ? mihomoConfig.configPath : mihomoConfig.mergePath);
}

function activeMihomoRuntimePath(config) {
  if (config.proxyClient?.mode === "none") return undefined;
  if (config.proxyClient?.mode === "embedded") return activeMihomoMergePath(config);
  return config.mihomo.runtimePath ? expandHome(config.mihomo.runtimePath) : undefined;
}

function findExternalProxyApp() {
  const candidates = [
    "/Applications/Clash Verge.app",
    "/Applications/Clash Verge Rev.app",
    join(homedir(), "Applications/Clash Verge.app"),
    join(homedir(), "Applications/Clash Verge Rev.app")
  ];
  return candidates.find((path) => existsSync(path)) || "";
}

function openExternalProxyApp() {
  const appPath = findExternalProxyApp();
  if (!appPath) return { opened: false, reason: "app-not-found" };
  const child = spawn("open", [appPath], {
    detached: true,
    stdio: "ignore"
  });
  child.unref();
  return { opened: true, appPath };
}

async function waitForExternalMihomo(mihomoConfig, { attempts = 20, intervalMs = 500 } = {}) {
  let lastError = "";
  for (let index = 0; index < attempts; index += 1) {
    try {
      const nodes = await listNodes(mihomoConfig);
      return { connected: true, nodeCount: nodes.nodes.length };
    } catch (error) {
      lastError = error.message;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
  return { connected: false, nodeCount: 0, error: lastError || "外部代理客户端未连接" };
}

async function startExternalProxy(config) {
  if (config.proxyClient?.mode === "embedded") {
    try {
      stopEmbeddedMihomo(config.embeddedMihomo);
    } catch {}
  }
  const openResult = openExternalProxyApp();
  const updatedConfig = updateSystemSettings({ proxyClient: { mode: "external" } });
  const externalState = await waitForExternalMihomo(updatedConfig.mihomo);
  return {
    config: updatedConfig,
    external: {
      ...externalState,
      ...openResult
    }
  };
}

function stopExternalProxy() {
  return updateSystemSettings({ proxyClient: { mode: "none" } });
}

function embeddedRouteEntries(config) {
  const embeddedConfig = { ...defaultConfig.embeddedMihomo, ...(config.embeddedMihomo || {}) };
  const mergePath = expandHome(embeddedConfig.configPath);
  return Object.entries(config.routes || {}).map(([key, route]) => ({
    key,
    ...route,
    nodeName: readOptionalListenerProxy(mergePath, parseProxyPort(route.proxyUrl))
  }));
}

function agentRouteSummary(route) {
  return {
    key: route.key,
    label: route.label,
    cdpPort: route.cdpPort,
    cdpEndpoint: `http://127.0.0.1:${route.cdpPort}`,
    cdpReady: route.cdpReady,
    proxyUrl: route.proxyUrl,
    proxyPort: route.proxyPort,
    proxyListening: route.proxyListening,
    nodeName: route.nodeName,
    nodeStatus: route.nodeStatus,
    userDataDir: route.userDataDir,
    profileDirectory: route.profileDirectory,
    startUrl: route.startUrl || "https://www.google.com/"
  };
}

function diagnostics(config) {
  const embeddedPaths = embeddedMihomoPaths(config.embeddedMihomo);
  const scriptLogPath = process.env.TK_BROWSER_WEBUI_LOG || join(homedir(), ".md-browser", "webui.log");
  return {
    app: appInfo(),
    configPath: configPath(),
    legacyConfigPath: legacyConfigPath(),
    scriptLogPath,
    proxyMode: config.proxyClient?.mode || "external",
    server: config.server,
    embeddedMihomo: {
      binaryPath: embeddedPaths.binaryPath,
      configPath: embeddedPaths.configPath,
      pidPath: embeddedPaths.pidPath,
      workDir: embeddedPaths.workDir
    }
  };
}

function redactSecret(value) {
  return value ? "[redacted]" : "";
}

export function sanitizeConfigForSupport(config) {
  return {
    version: config.version,
    server: config.server,
    profileRoot: config.profileRoot,
    userDataRootCount: Array.isArray(config.userDataRoots) ? config.userDataRoots.length : 0,
    chromeAppName: config.chromeAppName,
    proxyClient: config.proxyClient,
    agent: {
      mcpEnabled: config.agent?.mcpEnabled !== false
    },
    mihomo: {
      controllerUrl: config.mihomo?.controllerUrl || "",
      secret: redactSecret(config.mihomo?.secret),
      mergePath: config.mihomo?.mergePath || "",
      runtimePath: config.mihomo?.runtimePath || ""
    },
    embeddedMihomo: {
      controllerUrl: config.embeddedMihomo?.controllerUrl || "",
      secret: redactSecret(config.embeddedMihomo?.secret),
      binaryPath: config.embeddedMihomo?.binaryPath || "",
      configPath: config.embeddedMihomo?.configPath || "",
      subscriptionUrl: config.embeddedMihomo?.subscriptionUrl ? "[redacted]" : "",
      autoStart: Boolean(config.embeddedMihomo?.autoStart)
    },
    routes: Object.fromEntries(Object.entries(config.routes || {}).map(([key, route]) => [key, {
      label: route.label,
      startUrl: route.startUrl || "",
      cdpPort: route.cdpPort,
      proxyUrl: route.proxyUrl,
      profileName: route.profileName,
      hasUserDataDir: Boolean(route.userDataDir),
      profileDirectory: route.profileDirectory || "Default",
      hasBoundNode: Boolean(route.mihomoGroup)
    }]))
  };
}

function readRecentLogLines(logPath, maxLines = 120) {
  if (!logPath || !existsSync(logPath)) return [];
  try {
    return readFileSync(logPath, "utf8").split(/\r?\n/).filter(Boolean).slice(-maxLines);
  } catch {
    return [];
  }
}

export async function buildSupportBundle(config, { routeStatusImpl = routeStatus } = {}) {
  const diagnosticInfo = diagnostics(config);
  const routes = await routeStatusImpl(config);
  return {
    product: "MD-Browser",
    generatedAt: new Date().toISOString(),
    app: appInfo(),
    diagnostics: diagnosticInfo,
    config: sanitizeConfigForSupport(config),
    routeSummary: Object.values(routes).map((route) => ({
      key: route.key,
      label: route.label,
      cdpPort: route.cdpPort,
      cdpReady: Boolean(route.cdpReady),
      proxyPort: route.proxyPort,
      proxyListening: Boolean(route.proxyListening),
      nodeName: route.nodeName || "",
      nodeValid: route.nodeStatus?.valid !== false,
      nodeStatus: route.nodeStatus?.label || ""
    })),
    recentLogs: readRecentLogLines(diagnosticInfo.scriptLogPath)
  };
}

export function compareVersions(left, right) {
  const parse = (value) => String(value || "").replace(/^v/i, "").split(".").map((part) => Number.parseInt(part, 10) || 0);
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const diff = (a[index] || 0) - (b[index] || 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

export async function checkForUpdate({ currentVersion = appInfo().version, manifestUrl = process.env.MD_BROWSER_UPDATE_MANIFEST_URL || "https://github.com/csfuwwc/md-browser/releases/latest/download/latest-mac-arm64.json", fetchImpl = fetch } = {}) {
  if (!manifestUrl) return { configured: false, currentVersion, updateAvailable: false };
  const response = await fetchImpl(manifestUrl, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`更新清单读取失败: ${response.status}`);
  const manifest = await response.json();
  const latestVersion = manifest.version || "";
  return {
    configured: true,
    currentVersion,
    latestVersion,
    updateAvailable: compareVersions(latestVersion, currentVersion) > 0,
    manifestUrl,
    downloadUrl: manifest.downloadUrl || "",
    fileName: manifest.fileName || "",
    sha256: manifest.sha256 || "",
    notes: Array.isArray(manifest.notes) ? manifest.notes : []
  };
}

async function routeNodeDelay(key, config) {
  const route = config.routes[key];
  if (!route) {
    const error = new Error(`Unknown route: ${key}`);
    error.statusCode = 404;
    throw error;
  }
  const proxyPort = parseProxyPort(route.proxyUrl);
  const mergePath = activeMihomoMergePath(config);
  const nodeName = readOptionalListenerProxy(mergePath, proxyPort);
  if (!nodeName) {
    const error = new Error("当前配置未绑定节点");
    error.statusCode = 400;
    throw error;
  }
  return testNodeDelay(activeMihomoConfig(config), nodeName);
}

async function handleApi(req, res) {
  const url = new URL(req.url, "http://127.0.0.1");
  const config = loadConfig();

  if (req.method === "GET" && url.pathname === "/api/config") {
    return sendJson(res, 200, config);
  }

  if (req.method === "PATCH" && url.pathname === "/api/settings") {
    const patch = await readJson(req);
    if (patch?.proxyClient?.mode === "external" && config.proxyClient?.mode === "embedded") {
      try {
        stopEmbeddedMihomo(config.embeddedMihomo);
      } catch {}
    }
    return sendJson(res, 200, updateSystemSettings(patch));
  }

  if (req.method === "GET" && url.pathname === "/api/status") {
    return sendJson(res, 200, { routes: await routeStatus(config), config, app: appInfo() });
  }

  if (req.method === "GET" && url.pathname === "/api/diagnostics") {
    return sendJson(res, 200, diagnostics(config));
  }

  if (req.method === "GET" && url.pathname === "/api/support-bundle") {
    return sendJson(res, 200, await buildSupportBundle(config));
  }

  if (req.method === "GET" && url.pathname === "/api/update-check") {
    return sendJson(res, 200, await checkForUpdate({
      manifestUrl: url.searchParams.get("manifestUrl") || undefined
    }));
  }

  if (url.pathname.startsWith("/api/agent/") && config.agent?.mcpEnabled === false) {
    return sendJson(res, 403, { error: "Agent 通道已关闭，请在 MD-Browser 设置中开启 MCP 服务。" });
  }

  if (req.method === "GET" && url.pathname === "/api/agent/routes") {
    const routes = await routeStatus(config);
    return sendJson(res, 200, {
      routes: Object.values(routes).map(agentRouteSummary)
    });
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/agent/routes/")) {
    const key = decodeURIComponent(url.pathname.split("/").at(-1));
    const routes = await routeStatus(config);
    const route = routes[key];
    if (!route) return sendJson(res, 404, { error: `Unknown route: ${key}` });
    return sendJson(res, 200, { route: agentRouteSummary(route) });
  }

  if (req.method === "POST" && url.pathname.startsWith("/api/agent/routes/") && url.pathname.endsWith("/launch")) {
    const key = decodeURIComponent(url.pathname.split("/").at(-2));
    return sendJson(res, 200, await launchRouteAndConfirm(key, config));
  }

  if (req.method === "POST" && url.pathname.startsWith("/api/agent/routes/") && url.pathname.endsWith("/open-url")) {
    const key = decodeURIComponent(url.pathname.split("/").at(-2));
    const body = await readJson(req);
    return sendJson(res, 200, await openUrlInRoute(key, config, body.url));
  }

  if (req.method === "POST" && url.pathname.startsWith("/api/agent/routes/") && url.pathname.endsWith("/node-delay")) {
    const key = decodeURIComponent(url.pathname.split("/").at(-2));
    return sendJson(res, 200, await routeNodeDelay(key, config));
  }

  if (req.method === "GET" && url.pathname === "/api/profiles") {
    const profileRoot = expandHome(config.profileRoot);
    const configuredRoots = config.userDataRoots || [];
    const discoveredRoots = listImportableUserDataRootCandidates(configuredRoots)
      .filter((candidate) => candidate.exists)
      .map((candidate) => candidate.path);
    const selectableRoots = Array.from(new Set([...configuredRoots, ...discoveredRoots]));
    const userDataRoots = configuredRoots.map((root) => ({
      path: root,
      expandedPath: expandHome(root)
    }));
    const userDataDirs = listUserDataDirsForRoots(selectableRoots);
    return sendJson(res, 200, {
      profileRoot,
      userDataRoots,
      profiles: listProfiles(profileRoot),
      userDataDirs
    });
  }

  if (req.method === "GET" && url.pathname === "/api/user-data-root-candidates") {
    return sendJson(res, 200, {
      candidates: listImportableUserDataRootCandidates(config.userDataRoots || [])
    });
  }

  if (req.method === "GET" && url.pathname === "/api/browsers") {
    return sendJson(res, 200, {
      browsers: listChromiumBrowserCandidates()
    });
  }

  if (req.method === "GET" && url.pathname === "/api/proxy-clients") {
    return sendJson(res, 200, {
      clients: listExternalProxyClientCandidates(config.mihomo)
    });
  }

  if (req.method === "GET" && url.pathname === "/api/embedded-mihomo/status") {
    return sendJson(res, 200, await embeddedMihomoStatus(config.embeddedMihomo));
  }

  if (req.method === "POST" && url.pathname === "/api/embedded-mihomo/install") {
    return sendJson(res, 200, await installEmbeddedMihomo(config.embeddedMihomo));
  }

  if (req.method === "POST" && url.pathname === "/api/embedded-mihomo/config") {
    return sendJson(res, 200, writeEmbeddedMihomoConfig(config.embeddedMihomo, embeddedRouteEntries(config)));
  }

  if (req.method === "POST" && url.pathname === "/api/embedded-mihomo/start") {
    return sendJson(res, 200, startEmbeddedMihomo(config.embeddedMihomo, { routes: embeddedRouteEntries(config) }));
  }

  if (req.method === "POST" && url.pathname === "/api/embedded-mihomo/enable") {
    const embeddedConfig = config.proxyClient?.mode === "embedded"
      ? config
      : updateSystemSettings({ proxyClient: { mode: "embedded" } });
    return sendJson(res, 200, await enableEmbeddedMihomo(embeddedConfig));
  }

  if (req.method === "POST" && url.pathname === "/api/embedded-mihomo/repair") {
    const embeddedConfig = config.proxyClient?.mode === "embedded"
      ? config
      : updateSystemSettings({ proxyClient: { mode: "embedded" } });
    return sendJson(res, 200, await repairEmbeddedMihomo(embeddedConfig));
  }

  if (req.method === "POST" && url.pathname === "/api/embedded-mihomo/stop") {
    return sendJson(res, 200, stopEmbeddedMihomo(config.embeddedMihomo));
  }

  if (req.method === "POST" && url.pathname === "/api/external-proxy/start") {
    return sendJson(res, 200, await startExternalProxy(config));
  }

  if (req.method === "POST" && url.pathname === "/api/external-proxy/stop") {
    return sendJson(res, 200, { config: stopExternalProxy() });
  }

  if (req.method === "POST" && url.pathname === "/api/user-data-roots") {
    const body = await readJson(req);
    return sendJson(res, 200, addUserDataRoot(body.path));
  }

  if (req.method === "GET" && url.pathname === "/api/team-template") {
    const routes = await routeStatus(config);
    return sendJson(res, 200, buildTeamTemplate(routes));
  }

  if (req.method === "POST" && url.pathname === "/api/team-template/import") {
    const body = await readJson(req);
    const result = await importTeamTemplate(body.template ?? body, config);
    return sendJson(res, 200, result);
  }

  if (req.method === "DELETE" && url.pathname === "/api/user-data-roots") {
    const body = await readJson(req);
    return sendJson(res, 200, removeUserDataRoot(body.path));
  }

  if (req.method === "POST" && url.pathname === "/api/routes") {
    const body = await readJson(req);
    const created = createRoute(body);
    return sendJson(res, 200, created);
  }

  if (req.method === "PATCH" && url.pathname.startsWith("/api/routes/")) {
    const key = decodeURIComponent(url.pathname.split("/").at(-1));
    const patch = await readJson(req);
    return sendJson(res, 200, updateRoute(key, patch));
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/api/routes/")) {
    const key = decodeURIComponent(url.pathname.split("/").at(-1));
    const route = config.routes[key];
    if (!route) return sendJson(res, 404, { error: `Unknown route: ${key}` });
    const deleted = deleteRoute(key);
    const proxyPort = parseProxyPort(route.proxyUrl);
    const mergePath = activeMihomoMergePath(config);
    const merge = existsSync(mergePath) ? deleteListenerByPort(mergePath, proxyPort) : { port: proxyPort, changed: false, removed: false };
    const reload = await safeReloadConfig(activeMihomoConfig(config));
    return sendJson(res, 200, { config: deleted, merge, ...reload });
  }

  if (req.method === "POST" && url.pathname.startsWith("/api/routes/") && url.pathname.endsWith("/launch")) {
    const key = decodeURIComponent(url.pathname.split("/").at(-2));
    return sendJson(res, 200, await launchRouteAndConfirm(key, config));
  }

  if (req.method === "POST" && url.pathname.startsWith("/api/routes/") && url.pathname.endsWith("/repair-launch")) {
    const key = decodeURIComponent(url.pathname.split("/").at(-2));
    return sendJson(res, 200, await autoRepairLaunchRoute(key, config));
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/ports/") && url.pathname.endsWith("/inspect")) {
    const port = Number(url.pathname.split("/").at(-2));
    return sendJson(res, 200, await inspectTcpPort(port));
  }

  if (req.method === "POST" && url.pathname.startsWith("/api/ports/") && url.pathname.endsWith("/terminate")) {
    return sendJson(res, 403, { error: "MD-Browser 不会自动关闭其他浏览器进程。请使用具体浏览器配置的关闭按钮。" });
  }

  if (req.method === "POST" && url.pathname.startsWith("/api/routes/") && url.pathname.endsWith("/stop")) {
    const key = decodeURIComponent(url.pathname.split("/").at(-2));
    return sendJson(res, 200, await closeRouteBrowser(key, config));
  }

  if (req.method === "POST" && url.pathname.startsWith("/api/routes/") && url.pathname.endsWith("/foreground")) {
    const key = decodeURIComponent(url.pathname.split("/").at(-2));
    return sendJson(res, 200, await foregroundRouteWindow(key, config));
  }

  if (req.method === "POST" && url.pathname.startsWith("/api/routes/") && url.pathname.endsWith("/node-delay")) {
    const key = decodeURIComponent(url.pathname.split("/").at(-2));
    return sendJson(res, 200, await routeNodeDelay(key, config));
  }

  if (req.method === "POST" && url.pathname === "/api/chrome/foreground") {
    return sendJson(res, 200, await foregroundChromeWindow());
  }

  if (req.method === "GET" && url.pathname === "/api/mihomo/groups") {
    if (!activeMihomoConfig(config)) return sendJson(res, 400, { error: "未启动代理服务" });
    return sendJson(res, 200, await listGroups(activeMihomoConfig(config)));
  }

  if (req.method === "GET" && url.pathname === "/api/mihomo/nodes") {
    if (!activeMihomoConfig(config)) return sendJson(res, 400, { error: "未启动代理服务" });
    return sendJson(res, 200, await listNodes(activeMihomoConfig(config)));
  }

  if (req.method === "PUT" && url.pathname.startsWith("/api/routes/") && url.pathname.endsWith("/node")) {
    const key = decodeURIComponent(url.pathname.split("/").at(-2));
    const route = config.routes[key];
    if (!route) return sendJson(res, 404, { error: `Unknown route: ${key}` });
    const body = await readJson(req);
    const proxyPort = parseProxyPort(route.proxyUrl);
    const mergePath = activeMihomoMergePath(config);
    if (!mergePath || !activeMihomoConfig(config)) {
      return sendJson(res, 400, { error: "未启动代理服务，无法绑定节点。" });
    }
    if (config.proxyClient?.mode === "embedded" && !existsSync(mergePath)) {
      writeEmbeddedMihomoConfig(config.embeddedMihomo, embeddedRouteEntries(config));
    }
    const update = updateListenerProxyEverywhere({
      mergePath,
      runtimePath: activeMihomoRuntimePath(config),
      port: proxyPort,
      nodeName: body.node,
      listenerName: route.label || key
    });
    const reload = await safeReloadConfig(activeMihomoConfig(config));
    return sendJson(res, 200, { route: key, ...update, ...reload });
  }

  return sendJson(res, 404, { error: "not_found" });
}

async function handleMcpHttp(req, res) {
  if (req.method === "GET") {
    return sendJson(res, 200, {
      name: "md-browser",
      transport: "http",
      endpoint: "/mcp",
      tools: ["list_browser_configs", "get_browser_config", "launch_browser_config", "open_url_in_config", "test_config_node_delay"]
    });
  }
  if (req.method !== "POST") {
    res.writeHead(405, { "content-type": "application/json; charset=utf-8" });
    return res.end(`${JSON.stringify({ error: "Method not allowed" })}\n`);
  }
  const config = loadConfig();
  if (config.agent?.mcpEnabled === false) {
    return sendJson(res, 403, {
      jsonrpc: "2.0",
      id: null,
      error: { code: -32000, message: "Agent 通道已关闭，请在 MD-Browser 设置中开启 MCP 服务。" }
    });
  }
  const message = await readJson(req);
  const response = await handleMcpMessage(message, {
    callTool: callMcpTool,
    serverInfo: appInfo()
  });
  if (!response) {
    res.writeHead(202, { "content-type": "application/json; charset=utf-8" });
    return res.end("{}\n");
  }
  return sendJson(res, 200, response);
}

async function callMcpTool(name, args = {}) {
  const config = loadConfig();
  if (name === "list_browser_configs") {
    const routes = await routeStatus(config);
    return mcpToolText({ routes: Object.values(routes).map(agentRouteSummary) });
  }
  if (name === "get_browser_config") {
    const routes = await routeStatus(config);
    const route = routes[args.key];
    if (!route) {
      const error = new Error(`Unknown route: ${args.key}`);
      error.statusCode = 404;
      throw error;
    }
    return mcpToolText({ route: agentRouteSummary(route) });
  }
  if (name === "launch_browser_config") {
    return mcpToolText(await launchRouteAndConfirm(args.key, config));
  }
  if (name === "open_url_in_config") {
    return mcpToolText(await openUrlInRoute(args.key, config, args.url));
  }
  if (name === "test_config_node_delay") {
    return mcpToolText(await routeNodeDelay(args.key, config));
  }
  throw new Error(`Unknown tool: ${name}`);
}

function buildTeamTemplate(routes) {
  return {
    type: "md-browser.team-template",
    version: 1,
    exportedAt: new Date().toISOString(),
    configs: Object.values(routes).map((route) => ({
      name: route.label,
      startUrl: route.startUrl || "",
      expectedNode: route.nodeName || "",
      note: route.note || "",
      tags: Array.isArray(route.tags) ? route.tags : []
    }))
  };
}

async function importTeamTemplate(template, baseConfig) {
  const normalized = normalizeTeamTemplate(template);
  const nodeMap = await readNodeMap(activeMihomoConfig(baseConfig));
  const results = [];

  for (const item of normalized.configs) {
    const latestConfig = loadConfig();
    const ports = suggestRoutePorts(latestConfig.routes);
    const created = createRoute({
      label: item.name,
      startUrl: item.startUrl || "",
      tags: item.tags || [],
      note: item.note || "",
      cdpPort: ports.cdpPort,
      proxyUrl: `http://127.0.0.1:${ports.proxyPort}`,
      profileName: item.name
    });
    const routeKey = created.routeKey;
    const expectedNode = item.expectedNode || "";
    const nodeExists = Boolean(expectedNode && nodeMap.available && nodeMap.nodes.has(expectedNode));
    const result = {
      routeKey,
      name: item.name,
      cdpPort: ports.cdpPort,
      proxyPort: ports.proxyPort,
      expectedNode,
      nodeState: expectedNode ? (nodeExists ? "matched" : "missing") : "unbound"
    };

    if (nodeExists) {
      try {
        const configAfterCreate = loadConfig();
        updateListenerProxyEverywhere({
          mergePath: activeMihomoMergePath(configAfterCreate),
          runtimePath: activeMihomoRuntimePath(configAfterCreate),
          port: ports.proxyPort,
          nodeName: expectedNode,
          listenerName: item.name
        });
        result.nodeState = "bound";
      } catch (error) {
        result.nodeState = "bind_failed";
        result.error = error.message;
      }
    }

    results.push(result);
  }

  const shouldReload = results.some((result) => result.nodeState === "bound");
  let reload = null;
  if (shouldReload) {
    reload = await safeReloadConfig(activeMihomoConfig(loadConfig()));
  }

  return {
    imported: results.length,
    results,
    reload
  };
}

function normalizeTeamTemplate(input) {
  const template = typeof input === "string" ? JSON.parse(input) : input;
  if (!template || typeof template !== "object") {
    throw new Error("导入内容不是有效的 JSON 对象。");
  }
  if (template.type !== "md-browser.team-template") {
    throw new Error("不是 MD-Browser 团队配置模板。");
  }
  if (Number(template.version) !== 1) {
    throw new Error(`不支持的模板版本：${template.version}`);
  }
  if (!Array.isArray(template.configs) || !template.configs.length) {
    throw new Error("模板中没有可导入的浏览器配置。");
  }
  return {
    ...template,
    configs: template.configs.map((item, index) => normalizeTemplateConfig(item, index))
  };
}

function normalizeTemplateConfig(item, index) {
  if (!item || typeof item !== "object") {
    throw new Error(`第 ${index + 1} 条配置格式不正确。`);
  }
  const name = String(item.name || "").trim();
  if (!name) throw new Error(`第 ${index + 1} 条配置缺少名称。`);
  const startUrl = String(item.startUrl || "").trim();
  if (startUrl) new URL(startUrl);
  const tags = Array.isArray(item.tags)
    ? item.tags.map((tag) => String(tag).trim()).filter(Boolean)
    : [];
  return {
    name,
    startUrl,
    expectedNode: String(item.expectedNode || "").trim(),
    note: String(item.note || "").trim(),
    tags
  };
}

function suggestRoutePorts(routes) {
  const routeList = Object.values(routes || {});
  const usedCdpPorts = new Set(routeList.map((route) => Number(route.cdpPort)).filter(Number.isInteger));
  const usedProxyPorts = new Set(routeList.map((route) => parseProxyPort(route.proxyUrl)).filter(Number.isInteger));
  return {
    cdpPort: nextAvailablePort(usedCdpPorts, 9222),
    proxyPort: nextAvailablePort(usedProxyPorts, 18101)
  };
}

function nextAvailablePort(usedPorts, startPort) {
  let port = startPort;
  while (usedPorts.has(port)) port += 1;
  return port;
}

export async function autoRepairLaunchRoute(routeKey, config, {
  homeDir,
  isTcpListeningImpl = isTcpListening,
  fetchCdpVersionImpl = fetchCdpVersion,
  launchRouteImpl = launchRoute
} = {}) {
  const route = config.routes[routeKey];
  if (!route) throw new Error(`Unknown route: ${routeKey}`);
  const originalPort = Number(route.cdpPort);
  const repair = {
    originalPort,
    killed: [],
    portChanged: false
  };

  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (!(await isTcpListeningImpl(originalPort)) || await fetchCdpVersionImpl(originalPort)) {
      const result = await launchRouteImpl(routeKey, loadConfig({ homeDir }));
      return { ...result, repaired: true, ...repair };
    }
    await delay(200);
  }

  throw new Error(`指定 CDP 端口 ${originalPort} 仍被占用，无法启动该浏览器配置。`);
}

export async function launchRouteAndConfirm(routeKey, config, {
  launchRouteImpl = launchRoute,
  isTcpListeningImpl = isTcpListening,
  fetchCdpVersionImpl = fetchCdpVersion,
  timeoutMs = 10000
} = {}) {
  const result = await launchRouteImpl(routeKey, config);

  const route = config.routes[routeKey];
  const cdpPort = Number(result?.cdpPort || route?.cdpPort);
  const cdpVersion = await waitForConfirmedCdp(cdpPort, {
    isTcpListeningImpl,
    fetchCdpVersionImpl,
    timeoutMs
  });
  return {
    ...result,
    cdpPort,
    cdpReady: true,
    cdpVersion
  };
}

async function waitForConfirmedCdp(cdpPort, {
  isTcpListeningImpl = isTcpListening,
  fetchCdpVersionImpl = fetchCdpVersion,
  timeoutMs = 10000
} = {}) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await isTcpListeningImpl(cdpPort)) {
      const version = await fetchCdpVersionImpl(cdpPort);
      if (version) return version;
    }
    await delay(250);
  }
  throw new Error(`浏览器启动未完成，CDP 端口 ${cdpPort} 暂不可用。`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function appInfo({ packagePath = join(rootDir, "package.json") } = {}) {
  const parsed = JSON.parse(readFileSync(packagePath, "utf8"));
  const productName = parsed.build?.productName || parsed.productName || (parsed.name === "md-browser" ? "MD-Browser" : parsed.name) || "";
  return {
    name: parsed.name || "",
    productName,
    version: parsed.version || "",
    description: parsed.description || ""
  };
}

function serveStatic(req, res) {
  const url = new URL(req.url, "http://127.0.0.1");
  const requestPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = normalize(join(webDir, requestPath));
  if (!filePath.startsWith(webDir) || !existsSync(filePath)) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  const type = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png"
  }[extname(filePath)] || "text/plain; charset=utf-8";
  res.writeHead(200, {
    "content-type": type,
    "cache-control": "no-store"
  });
  createReadStream(filePath).pipe(res);
}

export function createAppServer() {
  return createServer((req, res) => {
  const pathname = new URL(req.url, "http://127.0.0.1").pathname;
  if (pathname === "/mcp") {
    handleMcpHttp(req, res).catch((error) => sendJson(res, error.statusCode || 500, {
      jsonrpc: "2.0",
      id: null,
      error: { code: -32603, message: error.message }
    }));
  } else if (req.url.startsWith("/api/")) {
    handleApi(req, res).catch((error) => sendJson(res, error.statusCode || 500, serializeApiError(error)));
  } else {
    serveStatic(req, res);
  }
  });
}

function serializeApiError(error) {
  return {
    error: error.message,
    ...(error.code ? { code: error.code } : {}),
    ...(error.port ? { port: error.port } : {}),
    ...(Array.isArray(error.processes) ? { processes: error.processes } : {})
  };
}

export function maybeAutoStartEmbeddedMihomo(config, { startImpl = startEmbeddedMihomo } = {}) {
  if (config.proxyClient?.mode !== "embedded") {
    return { started: false, reason: "not-embedded-mode" };
  }
  if (!config.embeddedMihomo?.autoStart) {
    return { started: false, reason: "auto-start-disabled" };
  }
  return startImpl(config.embeddedMihomo, { routes: embeddedRouteEntries(config) });
}

export async function enableEmbeddedMihomo(config, {
  statusImpl = embeddedMihomoStatus,
  installImpl = installEmbeddedMihomo,
  startImpl = startEmbeddedMihomo
} = {}) {
  const embeddedConfig = config.embeddedMihomo || {};
  if (!String(embeddedConfig.subscriptionUrl || "").trim()) {
    throw new Error("内置 Mihomo 需要先配置订阅地址。");
  }
  const status = await statusImpl(embeddedConfig);
  let install = null;
  if (!status.installed) {
    install = await installImpl(embeddedConfig);
  }
  const start = startImpl(embeddedConfig, { routes: embeddedRouteEntries(config) });
  return {
    installedNow: !status.installed,
    install,
    start,
    started: Boolean(start.started || start.alreadyRunning)
  };
}

export async function repairEmbeddedMihomo(config, {
  statusImpl = embeddedMihomoStatus,
  installImpl = installEmbeddedMihomo,
  stopImpl = stopEmbeddedMihomo,
  startImpl = startEmbeddedMihomo
} = {}) {
  const embeddedConfig = config.embeddedMihomo || {};
  if (!String(embeddedConfig.subscriptionUrl || "").trim()) {
    throw new Error("内置 Mihomo 需要先配置订阅地址。");
  }
  const actions = [];
  const status = await statusImpl(embeddedConfig);
  if (status.installed && status.apiConnected) {
    return { repaired: false, healthy: true, actions, status };
  }

  let install = null;
  let stop = null;
  let start = null;
  if (status.processRunning && !status.apiConnected) {
    stop = stopImpl(embeddedConfig);
    actions.push("restart");
  }
  if (!status.installed) {
    install = await installImpl(embeddedConfig);
    actions.push("install");
  }

  try {
    start = startImpl(embeddedConfig, { routes: embeddedRouteEntries(config) });
    actions.push(start.alreadyRunning ? "already-running" : "start");
  } catch (error) {
    if (!status.installed || install) throw error;
    install = await installImpl(embeddedConfig);
    actions.push("reinstall");
    start = startImpl(embeddedConfig, { routes: embeddedRouteEntries(config) });
    actions.push(start.alreadyRunning ? "already-running" : "start");
  }

  return {
    repaired: actions.length > 0,
    healthy: true,
    actions,
    status,
    stop,
    install,
    start,
    started: Boolean(start?.started || start?.alreadyRunning)
  };
}

export async function safeReloadConfig(mihomoConfig, { reloadImpl = reloadConfig } = {}) {
  try {
    return await reloadImpl(mihomoConfig);
  } catch (error) {
    return {
      reloaded: false,
      error: error.message
    };
  }
}

export function startServer(config = loadConfig()) {
  const server = createAppServer();
  try {
    const autoStart = maybeAutoStartEmbeddedMihomo(config);
    if (autoStart.started || autoStart.alreadyRunning) {
      console.log(`MD-Browser embedded Mihomo: ${autoStart.alreadyRunning ? "already running" : "started"}`);
    }
  } catch (error) {
    console.warn(`MD-Browser embedded Mihomo auto-start skipped: ${error.message}`);
  }
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.server.port, config.server.host, () => {
      server.off("error", reject);
      const url = `http://${config.server.host}:${config.server.port}`;
      console.log(`MD-Browser WebUI: ${url}`);
      resolve({ server, url, config });
    });
  });
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  startServer().then((result) => {
    runningServer = result.server;
  }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
