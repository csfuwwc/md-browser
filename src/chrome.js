import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { fetchCdpVersion, inspectTcpPort, isTcpListening } from "./ports.js";

const execFileAsync = promisify(execFile);

export function expandHome(path, homeDir = homedir()) {
  return path.startsWith("~/") ? join(homeDir, path.slice(2)) : path;
}

export function profileDir(config, route) {
  return join(userDataDir(config, route), profileDirectory(route));
}

export function userDataDir(config, route) {
  if (route.userDataDir) return expandHome(route.userDataDir);
  return join(expandHome(config.profileRoot), route.profileName || route.label || "env");
}

export function userDataDirName(config, route) {
  if (route.userDataDir) return basename(userDataDir(config, route));
  return route.profileName || basename(userDataDir(config, route));
}

export function profileDirectory(route) {
  return route.profileDirectory || "Default";
}

export function buildChromeArgs({ cdpPort, profileDir, profileDirectory, proxyUrl, startUrl, identityUrl }) {
  const args = [
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${profileDir}`,
    `--proxy-server=${proxyUrl}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--new-window"
  ];
  if (profileDirectory) args.push(`--profile-directory=${profileDirectory}`);
  if (identityUrl) args.push(identityUrl);
  args.push(startUrl || "https://www.google.com/");
  return args;
}

export function cleanSingletonLocks(dir) {
  for (const name of ["SingletonSocket", "SingletonCookie", "SingletonLock"]) {
    const path = join(dir, name);
    if (existsSync(path)) rmSync(path, { force: true });
  }
}

export function listProfiles(rootDir) {
  return listUserDataDirs(rootDir).map((entry) => entry.name);
}

export function listUserDataDirs(rootDir) {
  if (!existsSync(rootDir)) return [];
  return readdirSync(rootDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const path = join(rootDir, entry.name);
      return {
        name: entry.name,
        path,
        profileDirectories: listProfileDirectories(path)
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function listUserDataDirsForRoots(rootDirs) {
  return rootDirs.flatMap((rootDir) => {
    const expandedRoot = expandHome(rootDir);
    if (isDefaultChromeUserDataDir(expandedRoot)) return [];
    const rootLabel = userDataRootLabel(expandedRoot);
    const rootEntry = isChromeUserDataDir(expandedRoot)
      ? [{
          name: basename(expandedRoot),
          path: expandedRoot,
          profileDirectories: listProfileDirectories(expandedRoot),
          root: rootDir,
          rootPath: expandedRoot,
          rootLabel,
          label: rootLabel
        }]
      : [];
    if (rootEntry.length) return rootEntry;
    const childEntries = listUserDataDirs(expandedRoot).map((entry) => ({
      ...entry,
      root: rootDir,
      rootPath: expandedRoot,
      rootLabel,
      label: `${rootLabel}/${entry.name}`
    }));
    return [...rootEntry, ...childEntries];
  });
}

function userDataRootLabel(path) {
  const parts = path.split("/").filter(Boolean);
  const mdIndex = parts.lastIndexOf("MD-Browser");
  if (mdIndex >= 0) return parts.slice(mdIndex).join("/");
  const tkIndex = parts.lastIndexOf("TK Browser Router");
  if (tkIndex >= 0) return "Legacy Managed Profiles";
  const base = basename(path);
  if (base === "TKCountryProfiles") return "Imported Chrome Profiles";
  if (base === "SocialScraperProfiles") return "Imported Workspace Profiles";
  return base;
}

export function listImportableUserDataRootCandidates(configuredRoots = [], homeDir = homedir()) {
  const configured = new Set(configuredRoots.map((root) => expandHome(root, homeDir)));
  const candidates = [
    {
      path: "~/Library/Application Support/Google/TKCountryProfiles",
      label: "Imported Chrome Profiles (legacy)",
      kind: "pool"
    },
    {
      path: "~/Library/Application Support/Google/SocialScraperProfiles",
      label: "Imported Workspace Profiles (legacy)",
      kind: "pool"
    },
    {
      path: "~/Library/Application Support/MD-Browser/Profiles",
      label: "MD-Browser Managed Profiles",
      kind: "managed"
    },
    {
      path: "~/Library/Application Support/TK Browser Router/Profiles",
      label: "Legacy Managed Profiles",
      kind: "legacy-managed"
    }
  ];

  return candidates
    .map((candidate) => {
      const expandedPath = expandHome(candidate.path, homeDir);
      if (candidate.kind === "managed") {
        mkdirSync(expandedPath, { recursive: true });
      }
      return {
        ...candidate,
        expandedPath,
        exists: existsSync(expandedPath),
        alreadyAdded: configured.has(expandedPath)
      };
    })
    .filter((candidate) => candidate.exists)
    .sort((a, b) => a.label.localeCompare(b.label, "zh-CN"));
}

export function listChromiumBrowserCandidates(homeDir = homedir()) {
  const apps = [
    { appName: "Google Chrome", label: "Google Chrome" },
    { appName: "Google Chrome Beta", label: "Google Chrome Beta" },
    { appName: "Google Chrome Canary", label: "Google Chrome Canary" },
    { appName: "Microsoft Edge", label: "Microsoft Edge" },
    { appName: "Brave Browser", label: "Brave Browser" },
    { appName: "Chromium", label: "Chromium" },
    { appName: "Arc", label: "Arc" }
  ];
  const appRoots = [
    "/Applications",
    join(homeDir, "Applications")
  ];
  return apps.map((candidate) => {
    const paths = appRoots.map((root) => join(root, `${candidate.appName}.app`));
    const appPath = paths.find((path) => existsSync(path)) || "";
    return {
      ...candidate,
      installed: Boolean(appPath),
      path: appPath,
      cdpSupported: true
    };
  });
}

export function listProfileDirectories(userDataDirPath) {
  if (!existsSync(userDataDirPath)) return ["Default"];
  const names = readdirSync(userDataDirPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => isLikelyChromeProfileDir(userDataDirPath, name));
  if (!names.includes("Default")) names.unshift("Default");
  return Array.from(new Set(names)).sort(compareProfileDirectory);
}

function isLikelyChromeProfileDir(userDataDirPath, name) {
  if (name === "System Profile") return false;
  if (["Default", "Guest Profile"].includes(name)) return true;
  if (/^Profile \d+$/.test(name)) return true;
  return existsSync(join(userDataDirPath, name, "Preferences"));
}

function isChromeUserDataDir(path) {
  if (!existsSync(path)) return false;
  if (existsSync(join(path, "Local State"))) return true;
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .some((entry) => isLikelyChromeProfileDir(path, entry.name));
}

function compareProfileDirectory(a, b) {
  if (a === "Default") return -1;
  if (b === "Default") return 1;
  return a.localeCompare(b, undefined, { numeric: true });
}

export async function launchRoute(routeKey, config, {
  isTcpListeningImpl = isTcpListening,
  fetchCdpVersionImpl = fetchCdpVersion,
  inspectTcpPortImpl = inspectTcpPort,
  execFileImpl = execFileAsync
} = {}) {
  const route = config.routes[routeKey];
  if (!route) throw new Error(`Unknown route: ${routeKey}`);
  const dir = userDataDir(config, route);
  if (isDefaultChromeUserDataDir(dir)) {
    throw new Error("不能使用系统默认 Chrome 资料目录启动托管浏览器，请选择“新建独立身份”。");
  }
  if (await isTcpListeningImpl(route.cdpPort)) {
    const cdpVersion = await fetchCdpVersionImpl(route.cdpPort);
    if (!cdpVersion) {
      const info = await inspectTcpPortImpl(route.cdpPort);
      const processLabel = info.processes?.length
        ? `占用进程：${info.processes.map((item) => `${item.command || "未知进程"}(${item.pid})`).join("、")}`
        : "未识别到占用进程";
      const error = new Error(`端口 ${route.cdpPort} 已被占用，但不是可用的浏览器调试端口。${processLabel}。`);
      error.code = "CDP_PORT_CONFLICT";
      error.port = route.cdpPort;
      error.processes = info.processes || [];
      throw error;
    }
    await assertRoutePortOwner({ ...route, key: routeKey }, dir, inspectTcpPortImpl);
    return { alreadyRunning: true, cdpPort: route.cdpPort };
  }

  mkdirSync(dir, { recursive: true });
  cleanSingletonLocks(dir);

  if (process.platform !== "darwin") {
    throw new Error("This MVP currently supports macOS Chrome launch only.");
  }

  await execFileImpl("open", ["-na", config.chromeAppName, "--args", ...buildChromeArgs({
    cdpPort: route.cdpPort,
    profileDir: dir,
    profileDirectory: profileDirectory(route),
    proxyUrl: route.proxyUrl,
    identityUrl: browserIdentityUrl(config, routeKey),
    startUrl: route.startUrl
  })]);

  return { alreadyRunning: false, cdpPort: route.cdpPort };
}

export function isDefaultChromeUserDataDir(path) {
  const normalized = String(path || "").replace(/\/+$/, "");
  return /\/Library\/Application Support\/Google\/Chrome$/.test(normalized);
}

export async function openUrlInRoute(routeKey, config, url, options = {}) {
  const route = config.routes[routeKey];
  if (!route) throw new Error(`Unknown route: ${routeKey}`);
  const targetUrl = normalizeTargetUrl(url || route.startUrl || "https://www.google.com/");
  const launch = await launchRoute(routeKey, config);
  await waitForCdp(route.cdpPort, options);
  const opened = await openUrlInCdp(route.cdpPort, targetUrl, options);
  return {
    route: routeKey,
    label: route.label,
    url: targetUrl,
    cdpPort: route.cdpPort,
    cdpEndpoint: `http://127.0.0.1:${route.cdpPort}`,
    alreadyRunning: launch.alreadyRunning,
    ...opened
  };
}

export async function openUrlInCdp(cdpPort, url, { fetchImpl = fetch } = {}) {
  const targetUrl = normalizeTargetUrl(url);
  const response = await fetchImpl(`http://127.0.0.1:${cdpPort}/json/new?${encodeURIComponent(targetUrl)}`, {
    method: "PUT",
    signal: AbortSignal.timeout(3500)
  });
  if (!response.ok) throw new Error(`CDP 打开网址失败: ${response.status}`);
  const target = await response.json();
  return {
    opened: true,
    targetId: target.id || "",
    title: target.title || "",
    webSocketDebuggerUrl: target.webSocketDebuggerUrl || ""
  };
}

async function waitForCdp(cdpPort, { fetchImpl = fetch, timeoutMs = 8000 } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await isTcpListening(cdpPort)) {
      const version = await fetchCdpVersion(cdpPort);
      if (version) return version;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`浏览器已启动，但 CDP 端口 ${cdpPort} 暂未就绪。`);
}

export function normalizeTargetUrl(url) {
  const value = String(url || "").trim();
  if (!value) return "https://www.google.com/";
  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
  return new URL(withProtocol).toString();
}

export function browserIdentityUrl(config, routeKey) {
  const host = config.server?.host || "127.0.0.1";
  const port = config.server?.port || 18777;
  return `http://${host}:${port}/identity.html?route=${encodeURIComponent(routeKey)}`;
}

export async function foregroundChrome() {
  if (process.platform !== "darwin") return { supported: false };
  await execFileAsync("osascript", [
    "-e",
    'tell application "Google Chrome" to activate'
  ]);
  return { supported: true };
}

export async function foregroundChromeWindow() {
  if (process.platform !== "darwin") return { supported: false };
  await execFileAsync("osascript", [
    "-e",
    'tell application "Google Chrome" to activate',
    "-e",
    'tell application "Google Chrome" to set index of window 1 to 1',
    "-e",
    'tell application "Google Chrome" to set bounds of window 1 to {80, 80, 1280, 980}'
  ]);
  return { supported: true };
}

export async function foregroundRouteWindow(routeKey, config, { fetchImpl = fetch, execFileImpl = execFileAsync } = {}) {
  const route = config.routes[routeKey];
  if (!route) throw new Error(`Unknown route: ${routeKey}`);
  if (process.platform !== "darwin") return { supported: false };
  if (!(await isTcpListening(route.cdpPort))) {
    throw new Error("这条浏览器配置还没有启动，无法显示对应窗口。");
  }
  await assertRoutePortOwner({ ...route, key: routeKey }, userDataDir(config, route));

  const targets = await fetchRoutePageTargets(route.cdpPort, fetchImpl);
  const target = targets[0];
  if (!target?.webSocketDebuggerUrl) {
    throw new Error("没有从这个 CDP 端口读取到可定位的页面窗口。");
  }

  await bringCdpPageToFront(target.webSocketDebuggerUrl);
  await execFileImpl("osascript", ["-e", 'tell application "Google Chrome" to activate']);
  return { supported: true, matchedTitle: target.title || target.url || "" };
}

export async function closeRouteBrowser(routeKey, config, options = {}) {
  const route = config.routes[routeKey];
  if (!route) throw new Error(`Unknown route: ${routeKey}`);
  await assertRoutePortOwner({ ...route, key: routeKey }, userDataDir(config, route), options.inspectTcpPortImpl || inspectTcpPort);
  return closeCdpBrowser(route.cdpPort, options);
}

export async function closeCdpBrowser(cdpPort, { fetchImpl = fetch, WebSocketImpl = WebSocket } = {}) {
  const response = await fetchImpl(`http://127.0.0.1:${cdpPort}/json/version`, {
    signal: AbortSignal.timeout(2500)
  });
  if (!response.ok) throw new Error(`CDP 读取浏览器失败: ${response.status}`);
  const version = await response.json();
  if (!version?.webSocketDebuggerUrl) {
    throw new Error("没有从这个 CDP 端口读取到可关闭的浏览器连接。");
  }
  await sendCdpCommand(version.webSocketDebuggerUrl, "Browser.close", "CDP 关闭浏览器超时。", "CDP 关闭浏览器失败。", WebSocketImpl);
  return { closed: true, cdpPort };
}

export async function fetchRouteWindowTitles(cdpPort, fetchImpl = fetch) {
  const targets = await fetchRoutePageTargets(cdpPort, fetchImpl);
  return Array.from(new Set(targets.map((target) => normalizeWindowTitle(target.title)).filter(Boolean)));
}

export async function fetchRoutePageTargets(cdpPort, fetchImpl = fetch) {
  const response = await fetchImpl(`http://127.0.0.1:${cdpPort}/json/list`, {
    signal: AbortSignal.timeout(2500)
  });
  if (!response.ok) throw new Error(`CDP 读取窗口失败: ${response.status}`);
  const targets = await response.json();
  return (Array.isArray(targets) ? targets : [])
    .filter((target) => target.type === "page");
}

export function buildForegroundChromeWindowScript(titles) {
  const titleList = titles.map((title) => `"${escapeAppleScriptString(title)}"`).join(", ");
  return `
set targetTitles to {${titleList}}
tell application "Google Chrome"
  activate
  repeat with targetTitle in targetTitles
    repeat with chromeWindow in windows
      repeat with chromeTab in tabs of chromeWindow
        if title of chromeTab is targetTitle as text then
          set active tab index of chromeWindow to index of chromeTab
          set index of chromeWindow to 1
          return targetTitle as text
        end if
      end repeat
    end repeat
  end repeat
end tell
return ""
`;
}

export async function assertRoutePortOwner(route, expectedUserDataDir, inspectTcpPortImpl = inspectTcpPort) {
  const info = await inspectTcpPortImpl(route.cdpPort);
  if (isRoutePortOwnedByUserDataDir(info, route.cdpPort, expectedUserDataDir, route.key)) return true;
  const processLabel = info.processes?.length
    ? `当前占用：${info.processes.map((item) => `${item.command || "未知进程"}(${item.pid})`).join("、")}`
    : "当前未识别到占用进程";
  const error = new Error(`端口 ${route.cdpPort} 不是由这个浏览器配置启动的。MD-Browser 不会接管默认浏览器或其他程序。${processLabel}。`);
  error.code = "CDP_PORT_OWNER_MISMATCH";
  error.port = route.cdpPort;
  error.expectedUserDataDir = expectedUserDataDir;
  error.processes = info.processes || [];
  throw error;
}

export function isRoutePortOwnedByUserDataDir(info, cdpPort, expectedUserDataDir, routeKey = "") {
  const expected = normalizeProcessPath(expectedUserDataDir);
  const routeMarker = routeKey ? `identity.html?route=${encodeURIComponent(routeKey)}` : "";
  return (info.processes || []).some((processInfo) => {
    const command = String(processInfo.fullCommand || processInfo.command || "");
    if (!command.includes(`--remote-debugging-port=${cdpPort}`)) return false;
    const normalizedCommand = normalizeProcessPath(command);
    if (normalizedCommand.includes(`--user-data-dir=${expected}`)) return true;
    if (routeMarker && normalizedCommand.includes(routeMarker)) return true;
    return false;
  });
}

function normalizeProcessPath(value) {
  return String(value || "").replace(/\/+(\s|$)/g, "$1");
}

function normalizeWindowTitle(title) {
  return String(title || "").trim();
}

function escapeAppleScriptString(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

export async function bringCdpPageToFront(webSocketDebuggerUrl, WebSocketImpl = WebSocket) {
  return sendCdpCommand(webSocketDebuggerUrl, "Page.bringToFront", "CDP 定位窗口超时。", "CDP 定位窗口失败。", WebSocketImpl);
}

function sendCdpCommand(webSocketDebuggerUrl, method, timeoutMessage, failureMessage, WebSocketImpl = WebSocket) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocketImpl(webSocketDebuggerUrl);
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error(timeoutMessage));
    }, 2500);

    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ id: 1, method }));
    });

    socket.addEventListener("message", (event) => {
      const data = JSON.parse(String(event.data));
      if (data.id !== 1) return;
      clearTimeout(timer);
      socket.close();
      if (data.error) {
        reject(new Error(data.error.message || failureMessage));
      } else {
        resolve({ ok: true });
      }
    });

    socket.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("CDP WebSocket 连接失败。"));
    });
  });
}
