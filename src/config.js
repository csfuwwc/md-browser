import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

export const defaultConfig = {
  version: 1,
  server: {
    host: "127.0.0.1",
    port: 18777
  },
  profileRoot: "~/Library/Application Support/MD-Browser/Profiles",
  userDataRoots: [],
  chromeAppName: "Google Chrome",
  proxyClient: {
    mode: "external"
  },
  agent: {
    mcpEnabled: true
  },
  mihomo: {
    controllerUrl: "http://127.0.0.1:9090",
    secret: "",
    mergePath: "~/Library/Application Support/io.github.clash-verge-rev.clash-verge-rev/profiles/Merge.yaml"
  },
  embeddedMihomo: {
    controllerUrl: "http://127.0.0.1:19090",
    secret: "",
    binaryPath: "~/Library/Application Support/MD-Browser/bin/mihomo",
    configPath: "~/Library/Application Support/MD-Browser/mihomo/config.yaml",
    subscriptionUrl: "",
    autoStart: false
  },
  routes: {}
};

export function configPath({ homeDir = homedir() } = {}) {
  return join(homeDir, ".md-browser", "config.json");
}

export function legacyConfigPath({ homeDir = homedir() } = {}) {
  return join(homeDir, ".tk-browser-router", "config.json");
}

export function backupConfigFile(sourcePath, { reason = "backup", now = new Date() } = {}) {
  if (!existsSync(sourcePath)) return "";
  const stamp = timestampForBackup(now);
  const backupPath = join(dirname(sourcePath), `${basename(sourcePath, ".json")}.${reason}.${stamp}.json`);
  writeFileSync(backupPath, readFileSync(sourcePath, "utf8"));
  return backupPath;
}

export function loadConfig(options = {}) {
  const path = configPath(options);
  const legacyPath = legacyConfigPath(options);
  if (!existsSync(path) && existsSync(legacyPath)) {
    mkdirSync(dirname(path), { recursive: true });
    backupConfigFile(legacyPath, { reason: "legacy-backup", now: options.now });
    writeFileSync(path, readFileSync(legacyPath, "utf8"));
  }
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(defaultConfig, null, 2)}\n`);
    return structuredClone(defaultConfig);
  }

  const parsed = JSON.parse(readFileSync(path, "utf8"));
  return {
    ...defaultConfig,
    ...parsed,
    server: { ...defaultConfig.server, ...parsed.server },
    proxyClient: { ...defaultConfig.proxyClient, ...parsed.proxyClient },
    agent: { ...defaultConfig.agent, ...parsed.agent },
    mihomo: { ...defaultConfig.mihomo, ...parsed.mihomo },
    embeddedMihomo: { ...defaultConfig.embeddedMihomo, ...parsed.embeddedMihomo },
    routes: normalizeRoutes(parsed),
    userDataRoots: normalizeUserDataRoots(parsed)
  };
}

function timestampForBackup(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join("");
}

export function saveConfig(config, options = {}) {
  const path = configPath(options);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
  return config;
}

export function updateRoute(routeKey, patch, options = {}) {
  const config = loadConfig(options);
  if (!config.routes[routeKey]) {
    throw new Error(`Unknown route: ${routeKey}`);
  }
  const cleanPatch = sanitizeRoutePatch(patch);
  if (cleanPatch.userDataDir && isDefaultChromeUserDataDir(cleanPatch.userDataDir)) {
    throw new Error("不能使用系统默认 Chrome 资料目录，请选择“新建独立身份”。");
  }
  const nextRoute = { ...config.routes[routeKey], ...cleanPatch };
  if (cleanPatch.userDataDir === "") {
    applyManagedUserDataDir(nextRoute, options);
  }
  validateRouteUniqueness(config.routes, routeKey, nextRoute);
  config.routes[routeKey] = nextRoute;
  return saveConfig(config, options);
}

export function createRoute(input, options = {}) {
  const config = loadConfig(options);
  const route = normalizeRouteInput(input);
  if (!route.userDataDir) {
    applyManagedUserDataDir(route, options);
  }
  validateRouteUniqueness(config.routes, null, route);
  const key = makeRouteKey(route.label, config.routes);
  config.routes[key] = route;
  return {
    routeKey: key,
    config: saveConfig(config, options)
  };
}

function applyManagedUserDataDir(route, options = {}) {
  const profileName = safePathSegment(route.profileName || route.label);
  route.profileName = profileName;
  route.userDataDir = `${defaultConfig.profileRoot}/${profileName}`;
  route.profileDirectory = route.profileDirectory || "Default";
  mkdirSync(expandHomePath(join(route.userDataDir, route.profileDirectory), options.homeDir), { recursive: true });
  return route;
}

export function deleteRoute(routeKey, options = {}) {
  const config = loadConfig(options);
  if (!config.routes[routeKey]) {
    throw new Error(`Unknown route: ${routeKey}`);
  }
  delete config.routes[routeKey];
  return saveConfig(config, options);
}

export function addUserDataRoot(path, options = {}) {
  const config = loadConfig(options);
  const cleanPath = String(path || "").trim();
  if (!cleanPath) throw new Error("Missing user-data root path.");
  if (isDefaultChromeUserDataDir(expandHomePath(cleanPath, options.homeDir))) {
    throw new Error("不能导入系统默认 Chrome 资料目录。请使用 MD-Browser 独立身份目录。");
  }
  config.userDataRoots = Array.from(new Set([...(config.userDataRoots || []), cleanPath]));
  return saveConfig(config, options);
}

export function removeUserDataRoot(path, options = {}) {
  const config = loadConfig(options);
  const cleanPath = String(path || "").trim();
  config.userDataRoots = (config.userDataRoots || []).filter((root) => root !== cleanPath);
  return saveConfig(config, options);
}

export function updateSystemSettings(patch, options = {}) {
  const config = loadConfig(options);
  const cleanPatch = sanitizeSystemSettingsPatch(patch);
  const nextConfig = {
    ...config,
    ...cleanPatch,
    server: { ...config.server, ...(cleanPatch.server || {}) },
    proxyClient: { ...config.proxyClient, ...(cleanPatch.proxyClient || {}) },
    agent: { ...config.agent, ...(cleanPatch.agent || {}) },
    mihomo: { ...config.mihomo, ...(cleanPatch.mihomo || {}) },
    embeddedMihomo: { ...config.embeddedMihomo, ...(cleanPatch.embeddedMihomo || {}) }
  };
  return saveConfig(nextConfig, options);
}

function sanitizeSystemSettingsPatch(patch = {}) {
  const next = {};
  if (patch.chromeAppName !== undefined) {
    next.chromeAppName = String(patch.chromeAppName || "").trim() || defaultConfig.chromeAppName;
  }
  if (patch.profileRoot !== undefined) {
    next.profileRoot = String(patch.profileRoot || "").trim() || defaultConfig.profileRoot;
  }
  if (patch.server && typeof patch.server === "object") {
    const port = Number(patch.server.port);
    next.server = {
      host: String(patch.server.host || defaultConfig.server.host).trim(),
      port: Number.isInteger(port) && port > 0 && port <= 65535 ? port : defaultConfig.server.port
    };
  }
  if (patch.agent && typeof patch.agent === "object") {
    next.agent = {};
    if (patch.agent.mcpEnabled !== undefined) {
      next.agent.mcpEnabled = Boolean(patch.agent.mcpEnabled);
    }
  }
  if (patch.proxyClient && typeof patch.proxyClient === "object") {
    const mode = String(patch.proxyClient.mode || defaultConfig.proxyClient.mode).trim();
    next.proxyClient = {
      mode: ["external", "embedded", "none"].includes(mode) ? mode : defaultConfig.proxyClient.mode
    };
  }
  if (patch.mihomo && typeof patch.mihomo === "object") {
    next.mihomo = {};
    if (patch.mihomo.controllerUrl !== undefined) {
      const controllerUrl = String(patch.mihomo.controllerUrl || "").trim() || defaultConfig.mihomo.controllerUrl;
      new URL(controllerUrl);
      next.mihomo.controllerUrl = controllerUrl.replace(/\/$/, "");
    }
    if (patch.mihomo.secret !== undefined) {
      next.mihomo.secret = String(patch.mihomo.secret || "").trim();
    }
    if (patch.mihomo.mergePath !== undefined) {
      next.mihomo.mergePath = String(patch.mihomo.mergePath || "").trim() || defaultConfig.mihomo.mergePath;
    }
    if (patch.mihomo.runtimePath !== undefined) {
      next.mihomo.runtimePath = String(patch.mihomo.runtimePath || "").trim();
    }
  }
  if (patch.embeddedMihomo && typeof patch.embeddedMihomo === "object") {
    next.embeddedMihomo = {};
    if (patch.embeddedMihomo.controllerUrl !== undefined) {
      const controllerUrl = String(patch.embeddedMihomo.controllerUrl || "").trim() || defaultConfig.embeddedMihomo.controllerUrl;
      new URL(controllerUrl);
      next.embeddedMihomo.controllerUrl = controllerUrl.replace(/\/$/, "");
    }
    if (patch.embeddedMihomo.secret !== undefined) {
      next.embeddedMihomo.secret = String(patch.embeddedMihomo.secret || "").trim();
    }
    if (patch.embeddedMihomo.binaryPath !== undefined) {
      next.embeddedMihomo.binaryPath = String(patch.embeddedMihomo.binaryPath || "").trim() || defaultConfig.embeddedMihomo.binaryPath;
    }
    if (patch.embeddedMihomo.configPath !== undefined) {
      next.embeddedMihomo.configPath = String(patch.embeddedMihomo.configPath || "").trim() || defaultConfig.embeddedMihomo.configPath;
    }
    if (patch.embeddedMihomo.subscriptionUrl !== undefined) {
      const subscriptionUrl = String(patch.embeddedMihomo.subscriptionUrl || "").trim();
      if (subscriptionUrl) {
        let url;
        try {
          url = new URL(subscriptionUrl);
        } catch {
          throw new Error("请输入有效的内置 Mihomo 订阅地址。");
        }
        if (!["http:", "https:"].includes(url.protocol)) {
          throw new Error("内置 Mihomo 订阅地址必须是 http 或 https。");
        }
      }
      next.embeddedMihomo.subscriptionUrl = subscriptionUrl;
    }
    if (patch.embeddedMihomo.autoStart !== undefined) {
      next.embeddedMihomo.autoStart = Boolean(patch.embeddedMihomo.autoStart);
    }
  }
  return next;
}

function sanitizeRoutePatch(patch) {
  const allowed = [
    "label",
    "country",
    "startUrl",
    "tags",
    "note",
    "cdpPort",
    "proxyUrl",
    "profileName",
    "userDataDir",
    "profileDirectory",
    "mihomoGroup"
  ];
  return Object.fromEntries(Object.entries(patch).filter(([key]) => allowed.includes(key)));
}

function normalizeUserDataRoots(parsed = {}) {
  const roots = Array.isArray(parsed.userDataRoots) ? parsed.userDataRoots : defaultConfig.userDataRoots;
  return Array.from(new Set(roots.filter(Boolean).filter((root) => !isDefaultChromeUserDataDir(expandHomePath(root)))));
}

function normalizeRoutes(parsed = {}) {
  const routes = parsed.routes && typeof parsed.routes === "object"
    ? parsed.routes
    : defaultConfig.routes;
  return Object.fromEntries(
    Object.entries(routes).map(([key, route]) => {
      const normalized = normalizeRouteInput(route, {
        requireLabel: false,
        allowDefaultChromeUserDataDir: true
      });
      if (isDefaultChromeUserDataDir(expandHomePath(normalized.userDataDir))) {
        normalized.userDataDir = undefined;
        normalized.profileName = safePathSegment(normalized.profileName || normalized.label || key);
        normalized.profileDirectory = normalized.profileDirectory || "Default";
      }
      return [key, normalized];
    })
  );
}

function normalizeRouteInput(input = {}, options = {}) {
  const route = sanitizeRoutePatch(input);
  const label = String(route.label || "").trim();
  if (options.requireLabel !== false && !label) {
    throw new Error("Route label is required.");
  }

  const cdpPort = Number(route.cdpPort);
  if (!Number.isInteger(cdpPort) || cdpPort < 1 || cdpPort > 65535) {
    throw new Error(`Invalid CDP port: ${route.cdpPort}`);
  }

  const proxyUrl = String(route.proxyUrl || "").trim();
  if (!proxyUrl) throw new Error("Proxy URL is required.");
  const proxyPort = proxyPortFromUrl(proxyUrl);
  if (!Number.isInteger(proxyPort) || proxyPort < 1 || proxyPort > 65535) {
    throw new Error(`Invalid proxy URL: ${proxyUrl}`);
  }

  const profileName = String(route.profileName || basenameFromPath(route.userDataDir) || label).trim();
  const tags = Array.isArray(route.tags)
    ? route.tags.map((tag) => String(tag).trim()).filter(Boolean)
    : String(route.tags || "")
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean);

  const userDataDir = route.userDataDir ? String(route.userDataDir).trim() : undefined;
  if (!options.allowDefaultChromeUserDataDir && isDefaultChromeUserDataDir(userDataDir)) {
    throw new Error("不能使用系统默认 Chrome 资料目录，请选择“新建独立身份”。");
  }

  return {
    label,
    country: String(route.country || "").trim(),
    startUrl: route.startUrl === undefined ? "https://www.tiktok.com/" : String(route.startUrl).trim(),
    tags,
    note: String(route.note || "").trim(),
    cdpPort,
    proxyUrl,
    profileName,
    userDataDir,
    profileDirectory: route.profileDirectory ? String(route.profileDirectory).trim() : undefined,
    mihomoGroup: String(route.mihomoGroup || "").trim()
  };
}

function isDefaultChromeUserDataDir(path) {
  const normalized = String(path || "").replace(/\/+$/, "");
  return /\/Library\/Application Support\/Google\/Chrome$/.test(normalized);
}

function validateRouteUniqueness(routes, currentKey, nextRoute) {
  for (const [key, route] of Object.entries(routes)) {
    if (key === currentKey) continue;
    if (Number(route.cdpPort) === Number(nextRoute.cdpPort)) {
      throw new Error(`CDP port ${nextRoute.cdpPort} is already used by ${route.label}.`);
    }
    if (proxyPortFromUrl(route.proxyUrl) === proxyPortFromUrl(nextRoute.proxyUrl)) {
      throw new Error(`Proxy port ${proxyPortFromUrl(nextRoute.proxyUrl)} is already used by ${route.label}.`);
    }
  }
}

function proxyPortFromUrl(proxyUrl) {
  const url = new URL(String(proxyUrl));
  return Number(url.port || (url.protocol === "https:" ? 443 : 80));
}

function makeRouteKey(label, routes) {
  const base = slugify(label) || "env";
  let key = base;
  let counter = 2;
  while (routes[key]) {
    key = `${base}-${counter}`;
    counter += 1;
  }
  return key;
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function basenameFromPath(path) {
  const value = String(path || "").trim();
  if (!value) return "";
  return value.split("/").filter(Boolean).at(-1) || "";
}

function expandHomePath(path, homeDir = homedir()) {
  return String(path).startsWith("~/") ? join(homeDir, String(path).slice(2)) : String(path);
}

function safePathSegment(value) {
  const clean = String(value || "env")
    .trim()
    .replace(/[/:]/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 80);
  return clean || "env";
}
