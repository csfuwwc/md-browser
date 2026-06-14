let currentRoutes = {};
let userDataRoots = [];
let userDataDirOptions = [];
let autoImportFailedRoots = new Set();
let mihomoNodes = [];
let editingRouteKey = "";
let routeSearchQuery = "";
let routeStateFilter = "all";
const ROUTE_VIEW_MODE_KEY = "md-browser.routeViewMode";
const LEGACY_ROUTE_VIEW_MODE_KEY = "tk-browser-router.routeViewMode";
const GUIDE_DISMISSED_KEY = "md-browser.guideDismissed.v1";
let routeViewMode = loadRouteViewMode();
let activityLog = [];
let pendingLaunchKeys = new Set();
let pendingNodeDelayKeys = new Set();
let nodeDelayResults = new Map();
let activityFilterLabel = "全部日志";
let activityCategoryFilter = "all";
let serviceState = "checking";
let createValidationTouched = false;
let rootDialogMode = "discover";
let createAdvancedExpanded = false;
let currentPage = "dashboard";
let refreshInFlight = false;
let rootScanInFlight = false;
let currentConfig = null;
let settingsDirty = false;
let exportTemplateCache = null;
let embeddedStalePidNoticeShown = false;
let currentEmbeddedMihomoStatus = null;
let currentAppInfo = null;
let proxyOperationState = { external: "", embedded: "" };
let latestUpdateResult = null;
let changelogEntries = [];
let updateAutoCheckInFlight = false;

const PAGE_META = {
  dashboard: { eyebrow: "Local Browser Router", title: "仪表盘" },
  routes: { eyebrow: "Browser Configs", title: "浏览器配置" },
  storage: { eyebrow: "User Data Directories", title: "目录池" },
  nodes: { eyebrow: "Mihomo Node Pool", title: "节点池" },
  settings: { eyebrow: "System Settings", title: "系统设置" },
  activity: { eyebrow: "Activity Stream", title: "运行日志" }
};

const DEFAULT_SERVICE_URL = "http://127.0.0.1:18777";

function serviceBaseUrl() {
  const metaUrl = document
    .querySelector('meta[name="md-browser-service-url"]')
    ?.getAttribute("content")
    ?.trim();
  const baseUrl = metaUrl || DEFAULT_SERVICE_URL;
  return baseUrl.replace(/\/+$/, "");
}

function apiUrl(path) {
  return new URL(path, `${serviceBaseUrl()}/`).toString();
}

async function openExternalUrl(url) {
  const target = String(url || "").trim();
  if (!target) return false;
  try {
    await api("/api/open-external", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: target })
    });
    return true;
  } catch {}
  try {
    const opened = window.open(target, "_blank", "noopener,noreferrer");
    if (opened) return true;
  } catch {}
  try {
    window.location.href = target;
    return true;
  } catch {}
  return false;
}

function openDialogCompat(selector) {
  const dialog = typeof selector === "string" ? document.querySelector(selector) : selector;
  if (!dialog) return;
  if (typeof dialog.showModal === "function") {
    try {
      dialog.showModal();
      return;
    } catch {}
  }
  dialog.setAttribute("open", "open");
}

function closeDialogCompat(selector) {
  const dialog = typeof selector === "string" ? document.querySelector(selector) : selector;
  if (!dialog) return;
  if (typeof dialog.close === "function") {
    try {
      dialog.close();
      return;
    } catch {}
  }
  dialog.removeAttribute("open");
}

async function api(path, options) {
  let response;
  try {
    response = await fetch(apiUrl(path), options);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/Failed to fetch/i.test(message)) {
      throw new Error("WebUI 服务连接已断开，请重新启动本地页面服务。");
    }
    throw error;
  }
  if (!response.ok) {
    const text = await response.text();
    const error = new Error(normalizeApiErrorMessage(text || response.statusText));
    try {
      const payload = JSON.parse(text);
      if (payload && typeof payload === "object") {
        error.payload = payload;
        if (payload.code) error.code = payload.code;
        if (payload.port) error.port = payload.port;
        if (Array.isArray(payload.processes)) error.processes = payload.processes;
      }
    } catch {}
    throw error;
  }
  return response.json();
}

function normalizeApiErrorMessage(message) {
  let text = String(message || "").trim();
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed.error === "string") text = parsed.error;
  } catch {
    // Keep the raw text when the response is not JSON.
  }
  if (/401 Unauthorized|Mihomo API failed:\s*401/i.test(text)) {
    return "外部代理 API 未授权：请检查 Clash Verge 的访问密钥是否和 MD-Browser 设置一致。";
  }
  if (/Mihomo API connection failed|fetch failed/i.test(text)) {
    const mode = currentProxyMode() === "embedded" ? "内置 Mihomo" : "外部代理客户端";
    return `${mode}未连接：请检查控制地址、端口和代理服务是否已启动。`;
  }
  return text;
}

function currentProxyMode(config = currentConfig) {
  const mode = config?.proxyClient?.mode;
  return ["external", "embedded", "none"].includes(mode) ? mode : "external";
}

function routeState(route) {
  const browserReady = route.cdpReady ?? Boolean(route.cdpVersion);
  const proxyReady = Boolean(route.proxyListening);
  const tags = [
    {
      label: browserReady ? "浏览器运行中" : "浏览器未启动",
      tone: browserReady ? "running" : "neutral"
    }
  ];
  const issues = [];
  if (!proxyReady) {
    issues.push("代理离线");
    tags.unshift({ label: "代理离线", tone: "danger" });
  }
  if (route.nodeStatus && route.nodeStatus.valid === false) {
    issues.push(route.nodeStatus.label || "节点异常");
    tags.unshift({ label: route.nodeStatus.label || "节点异常", tone: "danger" });
  }
  if (!issues.length) return { tone: "ready", label: "可用", issues, tags, browserReady, proxyReady };
  return { tone: "unavailable", label: "不可用", issues, tags, browserReady, proxyReady };
}

function renderStatusSummary(routes) {
  const values = Object.values(routes);
  const browserCount = values.filter((route) => route.cdpReady ?? Boolean(route.cdpVersion)).length;
  document.querySelector("#dashboard-route-count").textContent = values.length;
  document.querySelector("#dashboard-browser-count").textContent = browserCount;
}

function setServiceState(state, detail = "") {
  const node = document.querySelector("#service-state");
  const settingsNode = document.querySelector("#settings-service-state");
  if (node) node.dataset.state = state;
  if (settingsNode) settingsNode.dataset.state = state;
  if (state === "online") {
    if (node) node.textContent = "正常";
    if (settingsNode) settingsNode.textContent = "正常";
  } else if (state === "offline") {
    if (node) node.textContent = "连接断开";
    if (settingsNode) settingsNode.textContent = "连接断开";
  } else {
    if (node) node.textContent = detail || "检测中";
    if (settingsNode) settingsNode.textContent = detail || "检测中";
  }
}

function updateServiceState(nextState, detail = "", { logTransition = false } = {}) {
  const previous = serviceState;
  serviceState = nextState;
  setServiceState(nextState, detail);
  if (!logTransition || previous === nextState) return;
  if (nextState === "offline") {
    pushActivity("error", "页面服务已断开", detail || "无法连接本地 WebUI 服务。");
  }
  if (nextState === "online" && previous === "offline") {
    pushActivity("success", "页面服务已恢复");
  }
}

function renderUserDataRoots() {
  const container = document.querySelector("#user-data-roots");
  const countNode = document.querySelector("#user-data-root-count");
  countNode.textContent = `${userDataRoots.length} 个目录池`;
  if (!userDataRoots.length) {
    container.innerHTML = "<div class=\"empty-state\"><strong>未配置目录池</strong><span>添加一个 Chrome user-data-dir 父目录或具体 user-data-dir。</span></div>";
    return;
  }
  container.innerHTML = userDataRoots.map((root) => `
    <div class="root-item">
      <span>${escapeHtml(root.path)}</span>
      <small>${escapeHtml(root.expandedPath || root.path)}</small>
    </div>
  `).join("");
}

function renderDashboardAlerts(routes) {
  const container = document.querySelector("#dashboard-alerts");
  const panel = container.closest(".dashboard-events-panel");
  const alerts = [];
  const routeValues = Object.values(routes);

  if (latestUpdateResult?.updateAvailable) {
    alerts.push({
      tone: "warn",
      title: `发现新版本 v${latestUpdateResult.latestVersion}`,
      detail: `当前版本 v${latestUpdateResult.currentVersion || currentAppInfo?.version || "-"}`,
      targetPage: "settings",
      actionLabel: "去更新"
    });
  }

  for (const route of routeValues) {
    const state = routeState(route);
    if (!route.nodeName) {
      alerts.push({
        tone: "warn",
        title: `${route.label} 未绑定节点`,
        detail: "这条配置保存后不会自动走节点切换。",
        targetPage: "routes",
        routeKey: route.key,
        action: "edit-route",
        actionLabel: "绑定节点"
      });
    }
    if (state.tone !== "ready") {
      const hasProxyIssue = state.issues.includes("代理离线");
      alerts.push({
        tone: "error",
        title: `${route.label} 不可用`,
        detail: state.issues.join("、"),
        targetPage: hasProxyIssue ? "settings" : "routes",
        routeKey: route.key,
        action: hasProxyIssue ? "proxy-settings" : "edit-route",
        actionLabel: hasProxyIssue ? "代理设置" : "检查配置"
      });
    }
  }

  const nodeIssueCount = routeValues.filter((route) => route.nodeStatus?.valid === false && route.nodeName).length;
  if (nodeIssueCount > 0) {
    alerts.unshift({
      tone: "error",
      title: `有 ${nodeIssueCount} 条配置节点失效`,
      detail: "通常是切换订阅后节点名变化，重新绑定一次即可恢复。",
      targetPage: "routes",
      actionLabel: "去处理",
      action: "jump"
    });
  }

  if (!alerts.length) {
    panel.style.display = "none";
    container.innerHTML = "";
    return;
  }

  panel.style.display = "block";
  container.innerHTML = alerts.slice(0, 6).map((alert) => `
    <button class="dashboard-alert-item" type="button" data-tone="${escapeAttr(alert.tone)}" data-target-page="${escapeAttr(alert.targetPage || "routes")}" data-route-key="${escapeAttr(alert.routeKey || "")}" data-action="${escapeAttr(alert.action || "jump")}">
      <span class="dashboard-alert-copy">
        <strong>${escapeHtml(alert.title)}</strong>
        <span>${escapeHtml(alert.detail)}</span>
      </span>
      <em>${escapeHtml(alert.actionLabel || "去处理")}</em>
    </button>
  `).join("");
  container.querySelectorAll(".dashboard-alert-item").forEach((item) => {
    item.addEventListener("click", () => jumpToDashboardAlert(item.dataset.targetPage, item.dataset.routeKey, item.dataset.action));
  });
}

function renderDashboardActivityPreview() {
  const container = document.querySelector("#dashboard-activity-preview");
  if (!container) return;
  const preview = activityLog.slice(0, 5);
  if (!preview.length) {
    container.innerHTML = `
      <div class="empty-state">
        <strong>暂无日志</strong>
        <span>启动浏览器、保存配置后会显示最近记录。</span>
      </div>
    `;
    return;
  }

  container.innerHTML = preview.map((entry) => `
    <article class="dashboard-log-item" data-level="${escapeAttr(entry.level)}">
      <div>
        <strong>${escapeHtml(entry.message)}</strong>
        ${entry.detail ? `<span>${escapeHtml(entry.detail)}</span>` : ""}
      </div>
      <time>${escapeHtml(entry.time)}</time>
    </article>
  `).join("");
}

function renderGuideReadiness({ routes = currentRoutes, config = currentConfig, roots = userDataRoots, nodes = mihomoNodes } = {}) {
  const routeValues = Object.values(routes || {});
  const proxyReady = currentProxyMode(config) !== "none" && (Array.isArray(nodes) ? nodes.length > 0 : false);
  const storageReady = Array.isArray(roots) && roots.length > 0;
  const routesReady = routeValues.length > 0;
  const launchReady = routeValues.some((route) => route.cdpReady ?? Boolean(route.cdpVersion));
  const agentReady = config?.agent?.mcpEnabled !== false;
  const states = {
    proxy: proxyReady,
    storage: storageReady,
    routes: routesReady,
    launch: launchReady,
    agent: agentReady
  };
  Object.entries(states).forEach(([key, done]) => {
    const node = document.querySelector(`[data-guide-step="${key}"] .guide-step-state`);
    if (!node) return;
    node.dataset.state = done ? "done" : "todo";
    node.textContent = done ? "已完成" : "待处理";
  });
}

function setCurrentPage(page) {
  const nextPage = PAGE_META[page] ? page : "dashboard";
  currentPage = nextPage;
  document.querySelectorAll(".workspace-page").forEach((node) => {
    node.classList.toggle("active", node.dataset.page === nextPage);
  });
  document.querySelectorAll(".rail-nav a").forEach((node) => {
    const nodePage = node.getAttribute("href").replace(/^#/, "") || "dashboard";
    node.classList.toggle("active", nodePage === nextPage);
  });
  document.querySelector("#topbar-eyebrow").textContent = PAGE_META[nextPage].eyebrow;
  document.querySelector("#topbar-title").textContent = PAGE_META[nextPage].title;
}

function jumpToDashboardAlert(page = "routes", routeKey = "", action = "jump") {
  window.location.hash = page || "routes";
  if (action === "proxy-settings") {
    window.setTimeout(() => {
      document.querySelector("#proxy-settings-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 120);
    return;
  }
  if (!routeKey) return;
  window.setTimeout(() => {
    const routeNode = document.querySelector(`[data-route-key="${CSS.escape(routeKey)}"]`);
    routeNode?.scrollIntoView({ behavior: "smooth", block: "center" });
    if (action === "edit-route") openCreateDialog(routeKey);
  }, 120);
}

function syncPageFromHash() {
  const hashPage = window.location.hash.replace(/^#/, "") || "dashboard";
  setCurrentPage(hashPage);
}

function renderSettingsBasics(app = currentAppInfo) {
  const versionNode = document.querySelector("#settings-version-value");
  const versionDetailNode = document.querySelector("#settings-version-detail");
  const localUrlNode = document.querySelector("#settings-local-url");
  if (versionNode) {
    versionNode.textContent = "MD-Browser";
  }
  if (versionDetailNode) {
    versionDetailNode.textContent = app?.version ? `v${app.version}` : "未读取到版本号";
  }
  if (localUrlNode) {
    localUrlNode.value = serviceBaseUrl();
  }
  const mcpMessage = document.querySelector("#settings-mcp-message");
  if (mcpMessage) mcpMessage.value = `请安装这个 MCP：${serviceBaseUrl()}/mcp`;
}

function renderVersionStatus(result = latestUpdateResult, app = currentAppInfo) {
  const versionNode = document.querySelector("#settings-version-value");
  const versionDetailNode = document.querySelector("#settings-version-detail");
  if (versionNode) versionNode.textContent = "MD-Browser";
  if (!versionDetailNode) return;

  const currentVersion = normalizeVersionLabel(result?.currentVersion || app?.version || "");
  if (result?.updateAvailable && result?.latestVersion) {
    versionDetailNode.textContent = `${currentVersion || "当前版本未知"} -> ${normalizeVersionLabel(result.latestVersion)}`;
    return;
  }
  versionDetailNode.textContent = currentVersion || "未读取到版本号";
}

function renderDiagnostics(data) {
  const versionDetailNode = document.querySelector("#settings-version-detail");
  if (!versionDetailNode || !data) return;
  if (!currentAppInfo?.version) versionDetailNode.textContent = "未读取到版本号";
}

function renderSettingsForm(config) {
  currentConfig = config;
  if (settingsDirty || !config) return;
  const proxyMode = currentProxyMode(config);
  document.querySelector("#settings-proxy-client-mode").value = proxyMode;
  document.querySelector("#settings-mihomo-controller").value = config.mihomo?.controllerUrl || "";
  document.querySelector("#settings-mihomo-secret").value = config.mihomo?.secret || "";
  document.querySelector("#settings-mihomo-merge-path").value = config.mihomo?.mergePath || "";
  document.querySelector("#settings-mihomo-runtime-path").value = config.mihomo?.runtimePath || "";
  document.querySelector("#settings-embedded-controller").value = config.embeddedMihomo?.controllerUrl || "";
  document.querySelector("#settings-embedded-secret").value = config.embeddedMihomo?.secret || "";
  document.querySelector("#settings-embedded-binary-path").value = config.embeddedMihomo?.binaryPath || "";
  document.querySelector("#settings-embedded-config-path").value = config.embeddedMihomo?.configPath || "";
  setEmbeddedSubscriptionValue(config.embeddedMihomo?.subscriptionUrl || "");
  document.querySelector("#settings-chrome-app-name").value = config.chromeAppName || "Google Chrome";
  document.querySelector("#settings-server-port").value = config.server?.port || 18777;
  document.querySelector("#settings-profile-root").value = config.profileRoot || "";
  document.querySelector("#settings-agent-mcp-enabled").checked = config.agent?.mcpEnabled !== false;
  renderProxyServiceCards();
  renderLocalBrowserSummary(config);
  renderAgentChannelState(config.agent?.mcpEnabled !== false);
  renderEmbeddedMihomoState();
  syncEmbeddedMihomoControls();
}

function embeddedSubscriptionInputs() {
  return Array.from(document.querySelectorAll("[data-embedded-subscription-input]"));
}

function embeddedSubscriptionValue() {
  return embeddedSubscriptionInputs().map((input) => input.value.trim()).find(Boolean) || "";
}

function setEmbeddedSubscriptionValue(value) {
  embeddedSubscriptionInputs().forEach((input) => {
    input.value = value;
  });
  renderEmbeddedSubscriptionPlacement();
}

function syncEmbeddedSubscriptionInputs(source) {
  const value = source.value;
  embeddedSubscriptionInputs().forEach((input) => {
    if (input !== source) input.value = value;
  });
  renderEmbeddedSubscriptionPlacement();
  syncEmbeddedMihomoControls(currentEmbeddedMihomoStatus || {});
}

function renderEmbeddedSubscriptionPlacement() {
  const button = document.querySelector("#configure-embedded-subscription");
  if (!button) return;
  button.textContent = embeddedSubscriptionValue() ? "切换订阅源" : "配置订阅源";
}

function repositoryBaseUrl() {
  return String(currentAppInfo?.repositoryUrl || "")
    .trim()
    .replace(/^git\+/, "")
    .replace(/\.git$/i, "")
    .replace(/#.*$/, "");
}

function issueFeedbackUrl() {
  return String(currentAppInfo?.issuesUrl || "").trim() || `${repositoryBaseUrl()}/issues`;
}

function normalizeVersionLabel(version) {
  const value = String(version || "").trim();
  if (!value) return "";
  return value.startsWith("v") ? value : `v${value}`;
}

function releaseDownloadUrl(version) {
  const base = repositoryBaseUrl();
  const rawVersion = String(version || "").trim().replace(/^v/i, "");
  if (!base || !rawVersion) return "";
  return `${base}/releases/download/${normalizeVersionLabel(rawVersion)}/MD-Browser-${rawVersion}-arm64.dmg`;
}

function markGuideDismissed() {
  localStorage.setItem(GUIDE_DISMISSED_KEY, "1");
}

function shouldOpenGuideOnboarding({ routes = currentRoutes, roots = userDataRoots, nodes = mihomoNodes, config = currentConfig } = {}) {
  if (localStorage.getItem(GUIDE_DISMISSED_KEY) === "1") return false;
  const routeValues = Object.values(routes || {});
  const proxyReady = currentProxyMode(config) !== "none" && Array.isArray(nodes) && nodes.length > 0;
  return !proxyReady || !roots.length || !routeValues.length;
}

function saveLatestUpdateResult(result) {
  latestUpdateResult = result || null;
  renderVersionStatus(latestUpdateResult);
}

async function maybeAutoCheckUpdates() {
  if (updateAutoCheckInFlight || latestUpdateResult) return;
  updateAutoCheckInFlight = true;
  try {
    const result = await api("/api/update-check");
    saveLatestUpdateResult(result);
    renderDashboardAlerts(currentRoutes);
  } catch (error) {
    saveLatestUpdateResult({ error: error.message });
  } finally {
    updateAutoCheckInFlight = false;
  }
}

function openGuideIfNeeded() {
  if (!shouldOpenGuideOnboarding()) return;
  window.setTimeout(() => {
    if (currentPage === "dashboard") {
      document.querySelector("#guide-dialog")?.showModal();
    }
  }, 180);
}

async function openVersionDownload(version) {
  const tag = String(version || "").trim();
  if (!tag) return;
  try {
    const result = await api(`/api/release-link?version=${encodeURIComponent(tag)}`);
    const url = result.url || "";
    if (!url) throw new Error("未生成可用下载地址");
    window.open(url, "_blank", "noopener,noreferrer");
  } catch (error) {
    const fallback = releaseDownloadUrl(tag);
    if (fallback) {
      window.open(fallback, "_blank", "noopener,noreferrer");
      return;
    }
    pushActivity("error", "打开版本下载失败", error.message);
  }
}

function openEmbeddedSubscriptionDialog() {
  clearEmbeddedSubscriptionError();
  setEmbeddedSubscriptionValue(embeddedSubscriptionValue());
  document.querySelector("#embedded-subscription-dialog").showModal();
  window.setTimeout(() => document.querySelector("#settings-embedded-subscription-url")?.focus(), 0);
}

function closeEmbeddedSubscriptionDialog() {
  document.querySelector("#embedded-subscription-dialog").close();
}

function setEmbeddedSubscriptionError(message) {
  const node = document.querySelector("#embedded-subscription-error");
  node.hidden = false;
  node.textContent = message;
}

function clearEmbeddedSubscriptionError() {
  const node = document.querySelector("#embedded-subscription-error");
  node.hidden = true;
  node.textContent = "";
}

function renderLocalBrowserSummary(config) {
  const browser = config?.chromeAppName || "Google Chrome";
  const summary = document.querySelector("#settings-browser-summary");
  const detail = document.querySelector("#settings-browser-detail");
  if (!summary || !detail) return;
  summary.textContent = browser;
  detail.textContent = `CDP 浏览器 · 服务端口 ${config?.server?.port || 18777} · 身份目录自动管理`;
}

function renderAgentChannelState(enabled) {
  const state = document.querySelector("#settings-agent-state");
  if (!state) return;
  state.textContent = enabled ? "已开启" : "已关闭";
  state.dataset.state = enabled ? "online" : "offline";
}

function renderProxyClientState({ connected, nodeCount = 0, detail = "" }) {
  const state = document.querySelector("#settings-proxy-client-state");
  const detailNode = document.querySelector("#settings-proxy-client-detail");
  if (!state || !detailNode) return;
  if (proxyOperationState.external) {
    state.dataset.state = "checking";
    state.textContent = proxyOperationState.external;
    detailNode.textContent = "正在更新外部代理客户端状态。";
    renderProxyServiceCards();
    return;
  }
  const proxyMode = currentProxyMode();
  const controllerUrl = currentConfig?.mihomo?.controllerUrl;
  const externalActive = proxyMode === "external";
  const isConnected = externalActive && connected;
  state.dataset.state = isConnected ? "online" : "offline";
  state.textContent = isConnected ? "已连接" : externalActive ? "未连接" : "未启动";
  detailNode.textContent = isConnected
    ? `节点池 ${nodeCount} 个`
    : detail || (proxyMode === "external" ? "未连接，可选择客户端或检查高级设置。" : "点击启动后使用外部代理。");
  renderProxyServiceCards();
}

function renderNodeBackendSummary({ connected = false, nodeCount = 0, error = "" } = {}) {
  const modeNode = document.querySelector("#node-backend-mode");
  const detailNode = document.querySelector("#node-backend-detail");
  const stateNode = document.querySelector("#node-backend-state");
  const healthNode = document.querySelector("#node-backend-health");
  const coreStateNode = document.querySelector("#node-embedded-core-state");
  const coreDetailNode = document.querySelector("#node-embedded-core-detail");
  if (!modeNode || !detailNode || !stateNode || !healthNode) return;

  const proxyMode = currentProxyMode();
  const controllerUrl = proxyMode === "embedded"
    ? currentConfig?.embeddedMihomo?.controllerUrl
    : proxyMode === "external" ? currentConfig?.mihomo?.controllerUrl : "";
  modeNode.textContent = proxyMode === "embedded" ? "内置 Mihomo" : proxyMode === "external" ? "外部代理客户端" : "未启动代理服务";
  detailNode.textContent = controllerUrl || "未配置控制地址";
  stateNode.dataset.state = connected ? "online" : error ? "offline" : "checking";
  stateNode.textContent = connected ? "已连接" : error ? "未连接" : "检测中";
  healthNode.textContent = connected
    ? `${nodeCount} 个可绑定节点`
    : error || "正在读取当前代理后端节点";
  if (coreStateNode && coreDetailNode) {
    const status = currentEmbeddedMihomoStatus || {};
    if (proxyMode !== "embedded") {
      coreStateNode.dataset.state = "checking";
      coreStateNode.textContent = "未启用";
      coreDetailNode.textContent = proxyMode === "external" ? "当前使用外部代理客户端" : "当前没有启用代理后端";
    } else if (status.installed && status.apiConnected) {
      coreStateNode.dataset.state = "online";
      coreStateNode.textContent = "已运行";
      coreDetailNode.textContent = status.version ? `API 已连接 · ${status.version}` : "API 已连接";
    } else if (status.installed) {
      coreStateNode.dataset.state = "offline";
      coreStateNode.textContent = status.processRunning ? "启动中" : "已安装";
      coreDetailNode.textContent = status.processRunning ? "进程已启动，等待 API 连接" : "Core 已安装，可在设置页启动";
    } else {
      coreStateNode.dataset.state = "offline";
      coreStateNode.textContent = "未安装";
      coreDetailNode.textContent = "在设置页点击“安装并启用”";
    }
  }
}

function renderProxyServiceCards() {
  const mode = currentProxyMode();
  const external = document.querySelector("#external-proxy-summary");
  const embedded = document.querySelector("#embedded-proxy-summary");
  const modeInput = document.querySelector("#settings-proxy-client-mode");
  const externalBadge = document.querySelector("#settings-external-active");
  const embeddedBadge = document.querySelector("#settings-embedded-active");
  const externalButton = document.querySelector("#toggle-external-proxy");
  const embeddedButton = document.querySelector("#toggle-embedded-mihomo");
  const embeddedRunning = Boolean(currentEmbeddedMihomoStatus?.processRunning || currentEmbeddedMihomoStatus?.apiConnected);
  if (modeInput) modeInput.value = mode;
  if (external) external.dataset.active = mode === "external" ? "true" : "false";
  if (embedded) embedded.dataset.active = mode === "embedded" ? "true" : "false";
  if (externalBadge) externalBadge.textContent = mode === "external" ? "使用中" : "未启用";
  if (embeddedBadge) embeddedBadge.textContent = mode === "embedded" && embeddedRunning ? "使用中" : "未启动";
  if (externalButton) {
    const active = mode === "external";
    externalButton.textContent = proxyOperationState.external || (active ? "停止" : "启动");
    externalButton.classList.toggle("danger", active);
    externalButton.classList.toggle("primary", !active);
  }
  if (embeddedButton) {
    const active = mode === "embedded" && embeddedRunning;
    embeddedButton.textContent = proxyOperationState.embedded || (active ? "停止" : "启动");
    embeddedButton.classList.toggle("danger", active);
    embeddedButton.classList.toggle("primary", !active);
    embeddedButton.disabled = !active && !embeddedSubscriptionValue();
    embeddedButton.title = embeddedButton.disabled ? "先填写订阅地址" : "";
  }
}

function setProxyOperationState(kind, label = "") {
  proxyOperationState = { ...proxyOperationState, [kind]: label };
  const state = document.querySelector(kind === "external" ? "#settings-proxy-client-state" : "#settings-embedded-state");
  const detail = document.querySelector(kind === "external" ? "#settings-proxy-client-detail" : "#settings-embedded-detail");
  if (state && label) {
    state.dataset.state = "checking";
    state.textContent = label;
  }
  if (detail && label) {
    detail.textContent = kind === "external" ? "正在更新外部代理客户端状态。" : "正在更新内置代理服务状态。";
  }
  renderProxyServiceCards();
}

function renderProxyModeSections(mode = currentProxyMode()) {
  const externalAdvanced = document.querySelector("#proxy-advanced-settings");
  const embeddedAdvanced = document.querySelector("#embedded-advanced-settings");
  if (mode !== "external" && externalAdvanced) externalAdvanced.hidden = true;
  if (mode !== "embedded" && embeddedAdvanced) embeddedAdvanced.hidden = true;
  renderProxyServiceCards();
  syncEmbeddedMihomoControls();
}

function setProxyAdvancedExpanded(expanded) {
  const section = document.querySelector("#proxy-advanced-settings");
  const button = document.querySelector("#toggle-proxy-advanced");
  section.hidden = !expanded;
  button.setAttribute("aria-expanded", expanded ? "true" : "false");
  button.textContent = expanded ? "收起高级" : "高级设置";
}

function setEmbeddedAdvancedExpanded(expanded) {
  const section = document.querySelector("#embedded-advanced-settings");
  const button = document.querySelector("#toggle-embedded-advanced");
  section.hidden = !expanded;
  button.setAttribute("aria-expanded", expanded ? "true" : "false");
  button.textContent = expanded ? "收起高级" : "高级设置";
}

function setLocalAdvancedExpanded(expanded) {
  const section = document.querySelector("#local-advanced-settings");
  const button = document.querySelector("#toggle-local-advanced");
  section.hidden = !expanded;
  button.setAttribute("aria-expanded", expanded ? "true" : "false");
  button.textContent = expanded ? "收起高级" : "高级设置";
}

async function openBrowserDialog() {
  const dialog = document.querySelector("#browser-dialog");
  dialog.showModal();
  await renderBrowserCandidates();
}

function closeBrowserDialog() {
  document.querySelector("#browser-dialog").close();
}

async function openProxyClientDialog() {
  const dialog = document.querySelector("#proxy-client-dialog");
  dialog.showModal();
  await renderProxyClientCandidates();
}

function closeProxyClientDialog() {
  document.querySelector("#proxy-client-dialog").close();
}

async function renderBrowserCandidates() {
  const container = document.querySelector("#browser-candidate-list");
  container.innerHTML = `
    <div class="empty-state">
      <strong>正在扫描本机浏览器</strong>
      <span>会查找常见 Chromium 浏览器。</span>
    </div>
  `;
  try {
    const data = await api("/api/browsers");
    const browsers = data.browsers || [];
    container.innerHTML = browsers.map((browser) => `
      <button class="browser-candidate" type="button" data-app-name="${escapeAttr(browser.appName)}" data-installed="${browser.installed ? "true" : "false"}" ${browser.installed ? "" : "disabled"}>
        <span class="browser-candidate-icon" aria-hidden="true"></span>
        <span>
          <strong>${escapeHtml(browser.label)}</strong>
          <small>${escapeHtml(browser.path || "未检测到安装路径")}</small>
        </span>
        <span class="browser-candidate-badge">${browser.installed ? "已检测" : "未安装"}</span>
      </button>
    `).join("");
    container.querySelectorAll(".browser-candidate").forEach((button) => {
      if (button.disabled) return;
      button.addEventListener("click", () => {
        document.querySelector("#settings-chrome-app-name").value = button.dataset.appName;
        renderLocalBrowserSummary({
          ...currentConfig,
          chromeAppName: button.dataset.appName,
          server: currentConfig?.server
        });
        markSettingsDirty();
        closeBrowserDialog();
      });
    });
  } catch (error) {
    container.innerHTML = `
      <div class="empty-state">
        <strong>扫描浏览器失败</strong>
        <span>${escapeHtml(error.message)}</span>
      </div>
    `;
  }
}

async function renderProxyClientCandidates() {
  const container = document.querySelector("#proxy-client-candidate-list");
  container.innerHTML = `
    <div class="empty-state">
      <strong>正在扫描代理客户端</strong>
      <span>会查找 Clash Verge / Mihomo-compatible 客户端。</span>
    </div>
  `;
  try {
    const data = await api("/api/proxy-clients");
    const clients = data.clients || [];
    if (!clients.length) {
      container.innerHTML = `
        <div class="empty-state">
          <strong>未检测到外部代理客户端</strong>
          <span>可以关闭弹窗后展开高级设置，手动填写 Mihomo API。</span>
        </div>
      `;
      return;
    }
    container.innerHTML = clients.map((client) => `
      <button class="browser-candidate" type="button"
        data-client-id="${escapeAttr(client.id)}"
        data-controller-url="${escapeAttr(client.controllerUrl || "")}"
        data-secret="${escapeAttr(client.secret || "")}"
        data-merge-path="${escapeAttr(client.mergePath || "")}"
        data-runtime-path="${escapeAttr(client.runtimePath || "")}"
        data-installed="${client.installed ? "true" : "false"}" ${client.installed ? "" : "disabled"}>
        <span class="browser-candidate-icon proxy-client-icon" aria-hidden="true"></span>
        <span>
          <strong>${escapeHtml(client.label)}</strong>
          <small>${escapeHtml(client.description || client.expandedMergePath || "手动配置")}</small>
        </span>
        <span class="browser-candidate-badge">${client.installed ? "可选择" : "未检测"}</span>
      </button>
    `).join("");
    container.querySelectorAll(".browser-candidate").forEach((button) => {
      if (button.disabled) return;
      button.addEventListener("click", () => {
        document.querySelector("#settings-mihomo-controller").value = button.dataset.controllerUrl || "";
        document.querySelector("#settings-mihomo-secret").value = button.dataset.secret || "";
        document.querySelector("#settings-mihomo-merge-path").value = button.dataset.mergePath || "";
        document.querySelector("#settings-mihomo-runtime-path").value = button.dataset.runtimePath || "";
        markSettingsDirty();
        closeProxyClientDialog();
      });
    });
  } catch (error) {
    container.innerHTML = `
      <div class="empty-state">
        <strong>扫描代理客户端失败</strong>
        <span>${escapeHtml(error.message)}</span>
      </div>
    `;
  }
}

async function detectProxyClient() {
  const button = document.querySelector("#detect-proxy-client");
  button.disabled = true;
  button.textContent = "刷新中...";
  try {
    await refresh({ suppressErrorLog: true });
    pushActivity("success", "代理客户端状态已刷新", mihomoNodes.length ? `节点 ${mihomoNodes.length} 个` : "未读取到节点");
  } catch (error) {
    pushActivity("error", "代理客户端状态刷新失败", error.message);
  } finally {
    button.disabled = false;
    button.textContent = "刷新状态";
  }
}

async function renderEmbeddedMihomoState() {
  const state = document.querySelector("#settings-embedded-state");
  const detail = document.querySelector("#settings-embedded-detail");
  const nextStep = document.querySelector("#settings-embedded-next-step");
  if (!state || !detail) return;
  try {
    const status = await api("/api/embedded-mihomo/status");
    currentEmbeddedMihomoStatus = status;
    const ready = status.installed && status.apiConnected;
    state.dataset.state = proxyOperationState.embedded ? "checking" : ready ? "online" : "offline";
    state.textContent = proxyOperationState.embedded || (ready ? "已运行" : status.installed ? "已安装" : "未安装");
    renderEmbeddedStatusChecks(status);
    detail.textContent = proxyOperationState.embedded
      ? "正在更新内置代理服务状态。"
      : status.apiConnected
      ? `内置代理服务正常${status.version ? ` · ${status.version}` : ""}`
      : status.installed
        ? "未完全就绪，可一键修复。"
        : "填写订阅地址后启动。";
    if (status.stalePidCleared && !embeddedStalePidNoticeShown) {
      embeddedStalePidNoticeShown = true;
      pushActivity("warn", "已清理内置 Mihomo 失效进程记录", "检测到旧 pid，但进程已不存在。");
    }
    renderEmbeddedNextStep(status);
    syncEmbeddedMihomoControls(status);
    renderNodeBackendSummary();
  } catch (error) {
    currentEmbeddedMihomoStatus = null;
    state.dataset.state = "offline";
    state.textContent = "检测失败";
    renderEmbeddedStatusChecks({});
    detail.textContent = error.message;
    if (nextStep) nextStep.textContent = "状态检测失败，请检查本地服务或稍后重试。";
    syncEmbeddedMihomoControls();
    renderNodeBackendSummary();
  }
}

function renderEmbeddedStatusChecks(status = {}) {
  const checks = document.querySelector("#settings-embedded-checks");
  if (!checks) return;
  const hasSubscription = Boolean(embeddedSubscriptionValue());
  const states = {
    installed: Boolean(status.installed),
    configExists: Boolean(hasSubscription && status.configExists),
    processRunning: Boolean(status.processRunning),
    apiConnected: Boolean(status.apiConnected)
  };
  Object.entries(states).forEach(([key, ready]) => {
    const node = checks.querySelector(`[data-check="${key}"]`);
    if (!node) return;
    node.dataset.ready = ready ? "true" : "false";
  });
}

function renderEmbeddedNextStep(status = {}) {
  const nextStep = document.querySelector("#settings-embedded-next-step");
  if (!nextStep) return;
  const hasSubscription = Boolean(embeddedSubscriptionValue());
  if (!hasSubscription) {
    nextStep.textContent = "";
    return;
  }
  if (settingsDirty) {
    nextStep.textContent = "启动时会自动保存。";
    return;
  }
  if (!status.installed) {
    nextStep.textContent = "启动会自动下载 Core。";
    return;
  }
  if (!status.configExists) {
    nextStep.textContent = "启动会自动写入配置。";
    return;
  }
  if (!status.processRunning) {
    nextStep.textContent = "点击启动接管节点池。";
    return;
  }
  if (!status.apiConnected) {
    nextStep.textContent = "API 未连接，可一键修复。";
    return;
  }
  nextStep.textContent = "";
}

function syncEmbeddedMihomoControls(status = null) {
  renderEmbeddedSubscriptionPlacement();
  const subscription = embeddedSubscriptionValue();
  const hasSubscription = Boolean(subscription);
  const repairButton = document.querySelector("#repair-embedded-mihomo");
  const toggleButton = document.querySelector("#toggle-embedded-mihomo");
  const running = Boolean(status?.processRunning || status?.apiConnected);
  if (toggleButton) {
    toggleButton.disabled = false;
    toggleButton.title = !hasSubscription && !running
      ? "先配置订阅地址"
      : settingsDirty && !running
        ? "会先保存当前设置，再启动"
        : "";
  }
  if (repairButton) {
    repairButton.disabled = !hasSubscription;
    repairButton.title = !hasSubscription
      ? "先填写订阅地址"
      : settingsDirty
        ? "会先保存当前设置，再修复"
        : "检测并修复内置 Mihomo";
  }
  renderProxyServiceCards();
  renderEmbeddedNextStep(status || {});
}

function validateEmbeddedAction({ requiresSubscription = false, autoSaveDirty = false } = {}) {
  if (!requiresSubscription) return true;
  const subscription = embeddedSubscriptionValue();
  if (!subscription) {
    document.querySelector("#settings-proxy-client-mode").value = "embedded";
    renderProxyModeSections("embedded");
    openEmbeddedSubscriptionDialog();
    setSettingsHint("error", "请先填写内置 Mihomo 的订阅地址。");
    pushActivity("error", "内置 Mihomo 未配置订阅地址", "先填写订阅地址。");
    return false;
  }
  if (settingsDirty && !autoSaveDirty) {
    setSettingsHint("error", "请先保存当前设置，再执行内置 Mihomo 操作。");
    pushActivity("error", "内置 Mihomo 设置未保存", "订阅地址或路径修改后，需要先保存。");
    return false;
  }
  return true;
}

async function runEmbeddedMihomoAction(buttonSelector, path, pendingText, successTitle, options = {}) {
  if (!validateEmbeddedAction(options)) return;
  const button = document.querySelector(buttonSelector);
  const nextStep = document.querySelector("#settings-embedded-next-step");
  const originalText = button.textContent;
  setProxyOperationState("embedded", pendingText);
  button.disabled = true;
  button.textContent = pendingText;
  if (nextStep) nextStep.textContent = pendingText;
  try {
    if (options.autoSaveDirty && settingsDirty) {
      if (nextStep) nextStep.textContent = "正在保存设置...";
      await persistSystemSettings({ refreshAfter: false, successMessage: "设置已保存，继续启用内置 Mihomo" });
      if (nextStep) nextStep.textContent = pendingText;
    }
    const result = await api(path, { method: "POST" });
    pushActivity("success", successTitle, result.asset?.name || result.configPath || result.binaryPath || "");
    setProxyOperationState("embedded", "");
    await renderEmbeddedMihomoState();
    await refresh({ suppressErrorLog: true });
  } catch (error) {
    pushActivity("error", successTitle.replace("已", "失败："), error.message);
    if (nextStep) nextStep.textContent = `操作失败：${error.message}`;
  } finally {
    setProxyOperationState("embedded", "");
    button.disabled = false;
    button.textContent = originalText;
    syncEmbeddedMihomoControls();
  }
}

function markSettingsDirty() {
  settingsDirty = true;
  const hint = document.querySelector("#settings-save-hint");
  hint.dataset.state = "";
  hint.textContent = "有未保存修改";
  syncEmbeddedMihomoControls();
}

function setSettingsHint(state, message) {
  const hint = document.querySelector("#settings-save-hint");
  hint.dataset.state = state;
  hint.textContent = message;
}

async function saveSystemSettings(event) {
  event.preventDefault();
  await persistSystemSettings();
}

function buildSystemSettingsPatch() {
  return {
    chromeAppName: document.querySelector("#settings-chrome-app-name").value.trim(),
    profileRoot: document.querySelector("#settings-profile-root").value.trim(),
    server: {
      host: currentConfig?.server?.host || "127.0.0.1",
      port: Number(document.querySelector("#settings-server-port").value)
    },
    agent: {
      mcpEnabled: document.querySelector("#settings-agent-mcp-enabled").checked
    },
    proxyClient: {
      mode: document.querySelector("#settings-proxy-client-mode")?.value || "external"
    },
    mihomo: {
      controllerUrl: document.querySelector("#settings-mihomo-controller").value.trim(),
      secret: document.querySelector("#settings-mihomo-secret").value.trim(),
      mergePath: document.querySelector("#settings-mihomo-merge-path").value.trim(),
      runtimePath: document.querySelector("#settings-mihomo-runtime-path").value.trim()
    },
    embeddedMihomo: {
      controllerUrl: document.querySelector("#settings-embedded-controller").value.trim(),
      secret: document.querySelector("#settings-embedded-secret").value.trim(),
      binaryPath: document.querySelector("#settings-embedded-binary-path").value.trim(),
      configPath: document.querySelector("#settings-embedded-config-path").value.trim(),
      subscriptionUrl: embeddedSubscriptionValue(),
      autoStart: Boolean(currentConfig?.embeddedMihomo?.autoStart)
    }
  };
}

async function persistSystemSettings({ refreshAfter = true, successMessage = "已保存，服务端口修改需重启应用后生效" } = {}) {
  const submit = document.querySelector("#settings-save");
  submit.disabled = true;
  setSettingsHint("", "正在保存...");
  try {
    const config = await api("/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildSystemSettingsPatch())
    });
    currentConfig = config;
    settingsDirty = false;
    setSettingsHint("success", successMessage);
    pushActivity("success", "系统设置已保存");
    renderProxyModeSections(currentProxyMode(config));
    if (refreshAfter) await refresh({ suppressErrorLog: true });
    return config;
  } catch (error) {
    setSettingsHint("error", error.message);
    pushActivity("error", "系统设置保存失败", error.message);
    throw error;
  } finally {
    submit.disabled = false;
  }
}

async function switchProxyClientMode(mode) {
  document.querySelector("#settings-proxy-client-mode").value = mode;
  renderProxyModeSections(mode);
  markSettingsDirty();
  await persistSystemSettings({
    successMessage: mode === "embedded" ? "已切换到内置 Mihomo" : mode === "external" ? "已切换到外部代理客户端" : "已停用代理后端"
  });
}

async function toggleExternalProxy() {
  const button = document.querySelector("#toggle-external-proxy");
  const originalText = button.textContent;
  if (currentProxyMode() === "external") {
    setProxyOperationState("external", "停止中...");
    button.disabled = true;
    button.textContent = "停止中...";
    try {
      const result = await api("/api/external-proxy/stop", { method: "POST" });
      currentConfig = result.config;
      setSettingsHint("success", "已停用外部代理接入");
      pushActivity("success", "已停用外部代理接入");
      setProxyOperationState("external", "");
      await refresh({ suppressErrorLog: true });
    } finally {
      setProxyOperationState("external", "");
      button.disabled = false;
      button.textContent = originalText;
      renderProxyServiceCards();
    }
    return;
  }
  button.disabled = true;
  setProxyOperationState("external", "启动中...");
  button.textContent = "启动中...";
  try {
    const result = await api("/api/external-proxy/start", { method: "POST" });
    currentConfig = result.config;
    const detail = result.external?.connected
      ? `节点 ${result.external.nodeCount} 个`
      : result.external?.error || (result.external?.reason === "app-not-found" ? "未找到 Clash Verge 应用" : "");
    pushActivity(result.external?.connected ? "success" : "warn", "外部代理已切换", detail);
    setSettingsHint(result.external?.connected ? "success" : "error", result.external?.connected ? "已启动外部代理客户端" : detail);
    setProxyOperationState("external", "");
    await renderEmbeddedMihomoState();
    await refresh({ suppressErrorLog: true });
  } finally {
    setProxyOperationState("external", "");
    button.disabled = false;
    button.textContent = originalText;
    renderProxyServiceCards();
  }
}

async function toggleEmbeddedMihomo() {
  const running = Boolean(currentEmbeddedMihomoStatus?.processRunning || currentEmbeddedMihomoStatus?.apiConnected);
  if (!running && !embeddedSubscriptionValue()) {
    openEmbeddedSubscriptionDialog();
    return;
  }
  if (currentProxyMode() === "embedded" && running) {
    await runEmbeddedMihomoAction("#toggle-embedded-mihomo", "/api/embedded-mihomo/stop", "停止中...", "内置 Mihomo 已停止");
    await switchProxyClientMode("none");
    return;
  }
  document.querySelector("#settings-proxy-client-mode").value = "embedded";
  await runEmbeddedMihomoAction("#toggle-embedded-mihomo", "/api/embedded-mihomo/enable", "启动中...", "内置 Mihomo 已启动", { requiresSubscription: true, autoSaveDirty: true });
}

async function repairEmbeddedMihomo() {
  document.querySelector("#settings-proxy-client-mode").value = "embedded";
  await runEmbeddedMihomoAction("#repair-embedded-mihomo", "/api/embedded-mihomo/repair", "修复中...", "内置 Mihomo 已修复", { requiresSubscription: true, autoSaveDirty: true });
}

async function saveEmbeddedSubscription({ startAfter = false } = {}) {
  clearEmbeddedSubscriptionError();
  if (!embeddedSubscriptionValue()) {
    setEmbeddedSubscriptionError("请输入订阅地址。");
    document.querySelector("#settings-embedded-subscription-url")?.focus();
    return;
  }
  const saveButton = document.querySelector(startAfter ? "#save-start-embedded-subscription" : "#save-embedded-subscription");
  const originalText = saveButton.textContent;
  saveButton.disabled = true;
  saveButton.textContent = startAfter ? "保存并启动中..." : "保存中...";
  try {
    await persistSystemSettings({ refreshAfter: false, successMessage: "内置 Mihomo 订阅地址已保存" });
    closeEmbeddedSubscriptionDialog();
    await renderEmbeddedMihomoState();
    if (startAfter) {
      document.querySelector("#settings-proxy-client-mode").value = "embedded";
      await runEmbeddedMihomoAction("#toggle-embedded-mihomo", "/api/embedded-mihomo/enable", "启动中...", "内置 Mihomo 已启动", { requiresSubscription: true, autoSaveDirty: false });
    } else {
      await refresh({ suppressErrorLog: true });
    }
  } catch (error) {
    setEmbeddedSubscriptionError(error.message);
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = originalText;
  }
}

function setCreateAdvancedExpanded(expanded) {
  createAdvancedExpanded = expanded;
  const section = document.querySelector("#create-advanced-fields");
  const button = document.querySelector("#toggle-create-advanced");
  const divider = document.querySelector("#create-advanced-divider");
  section.hidden = !expanded;
  divider.hidden = expanded;
  button.setAttribute("aria-expanded", expanded ? "true" : "false");
}

function renderRoutes(routes) {
  currentRoutes = routes;
  renderRouteIssueBanner(routes);
  const container = document.querySelector("#routes");
  const template = document.querySelector("#route-card-template");
  container.innerHTML = "";
  container.dataset.view = routeViewMode;
  syncRouteViewButtons();

  const routeValues = Object.values(routes);
  const filteredRoutes = routeValues
    .sort((a, b) => a.label.localeCompare(b.label, "zh-CN"))
    .filter(matchesRouteFilters);

  if (!routeValues.length) {
    renderRouteCreatePlaceholder(container);
    return;
  }

  if (!filteredRoutes.length) {
    container.innerHTML = `
      <div class="empty-state route-empty-state">
        <strong>没有匹配的配置</strong>
        <span>调整搜索词或状态筛选，或者新建一条浏览器配置。</span>
      </div>
    `;
    return;
  }

  for (const route of filteredRoutes) {
    const state = routeState(route);
    const row = template.content.firstElementChild.cloneNode(true);
    row.dataset.state = state.tone;
    row.dataset.routeKey = route.key;

    row.querySelector(".country-code").textContent = routeInitials(route.label);
    row.querySelector(".route-label").textContent = route.label;
    row.querySelector(".route-country").textContent = formatSubtitle(route);
    row.querySelector(".route-tags").innerHTML = (route.tags || []).map((tag) => `<span>${escapeHtml(tag)}</span>`).join("");
    row.querySelector(".state-pill").classList.add(state.tone);
    row.querySelector(".state-pill span").textContent = state.label;
    row.querySelector(".route-issues").innerHTML = state.tags.map((tag) => `
      <span data-tone="${escapeAttr(tag.tone)}">${escapeHtml(tag.label)}</span>
    `).join("");
    row.querySelector(".cdp-port").textContent = route.cdpPort;
    row.querySelector(".node-name").textContent = route.nodeName || "未绑定";
    renderRouteNodeDelay(row, route);
    row.querySelector(".start-url").textContent = route.startUrl || "https://www.google.com/";
    const launchButton = row.querySelector(".launch-route");
    const editButton = row.querySelector(".edit-route");
    const isLaunching = pendingLaunchKeys.has(route.key);
    const primaryActionLabel = state.browserReady ? "关闭浏览器" : "启动浏览器";
    launchButton.dataset.tooltip = isLaunching ? "处理中..." : primaryActionLabel;
    launchButton.setAttribute("aria-label", isLaunching ? "处理中" : primaryActionLabel);
    launchButton.disabled = isLaunching;
    launchButton.dataset.state = isLaunching ? "active" : "";
    launchButton.querySelector(".action-icon").classList.toggle("action-icon-stop", state.browserReady);
    launchButton.querySelector(".action-icon").classList.toggle("action-icon-launch", !state.browserReady);

    launchButton.addEventListener("click", () => {
      if (state.browserReady) {
        stopRoute(route.key);
      } else {
        launchRoute(route.key);
      }
    });
    row.querySelector(".foreground-route").addEventListener("click", () => foregroundChrome(route.key, route.label));
    row.querySelector(".node-delay-button").addEventListener("click", () => testRouteNodeDelay(route.key, route.label));
    editButton.addEventListener("click", () => openCreateDialog(route.key));
    row.querySelector(".delete-route").addEventListener("click", () => deleteRouteConfig(route.key, route.label));
    editButton.setAttribute("aria-label", "编辑配置");
    editButton.dataset.tooltip = "编辑配置";
    editButton.dataset.state = "";

    container.appendChild(row);
  }
}

function renderRouteIssueBanner(routes = currentRoutes) {
  const banner = document.querySelector("#route-issue-banner");
  if (!banner) return;
  const routeValues = Object.values(routes || {});
  const invalid = routeValues.filter((route) => route.nodeStatus?.valid === false && route.nodeName);
  const unbound = routeValues.filter((route) => !route.nodeName);
  const title = document.querySelector("#route-issue-banner-title");
  const detail = document.querySelector("#route-issue-banner-detail");
  if (!invalid.length && !unbound.length) {
    banner.hidden = true;
    return;
  }
  banner.hidden = false;
  if (invalid.length) {
    title.textContent = `${invalid.length} 条浏览器配置需要重新绑定节点`;
    detail.textContent = "检测到已绑定节点不存在或不可用，常见于订阅切换后节点名发生变化。";
    return;
  }
  title.textContent = `${unbound.length} 条浏览器配置还未绑定节点`;
  detail.textContent = "未绑定节点的配置可以启动浏览器，但不会自动切到指定线路。";
}

function routeNodeDelayKey(route) {
  return `${route.key}:${route.nodeName || ""}`;
}

function renderRouteNodeDelay(row, route) {
  const button = row.querySelector(".node-delay-button");
  const result = row.querySelector(".node-delay-result");
  const hasNode = Boolean(route.nodeName);
  const isPending = pendingNodeDelayKeys.has(route.key);
  const cached = nodeDelayResults.get(routeNodeDelayKey(route));

  button.disabled = !hasNode || isPending;
  button.textContent = isPending ? "测速中" : "测速";

  if (!hasNode) {
    result.dataset.state = "idle";
    result.textContent = "未绑定节点";
    return;
  }
  if (isPending) {
    result.dataset.state = "testing";
    result.textContent = "正在测速...";
    return;
  }
  if (!cached) {
    result.dataset.state = "idle";
    result.textContent = "未测速";
    return;
  }
  result.dataset.state = cached.state;
  result.textContent = cached.label;
}

function nodeDelayState(delay) {
  if (delay <= 300) return "good";
  if (delay <= 800) return "warn";
  return "bad";
}

async function testRouteNodeDelay(routeKey, label) {
  const route = currentRoutes[routeKey];
  if (!route?.nodeName || pendingNodeDelayKeys.has(routeKey)) return;
  pendingNodeDelayKeys.add(routeKey);
  renderRoutes(currentRoutes);
  try {
    const data = await api(`/api/routes/${encodeURIComponent(routeKey)}/node-delay`, { method: "POST" });
    const delay = Number(data.delay);
    nodeDelayResults.set(routeNodeDelayKey(route), {
      state: nodeDelayState(delay),
      label: `${delay} ms`
    });
    pushActivity("success", `${label} 节点测速完成`, `${route.nodeName}: ${delay} ms`);
  } catch (error) {
    nodeDelayResults.set(routeNodeDelayKey(route), {
      state: "error",
      label: "测速失败"
    });
    pushActivity("error", `${label} 节点测速失败`, error.message);
  } finally {
    pendingNodeDelayKeys.delete(routeKey);
    renderRoutes(currentRoutes);
  }
}

function renderRouteCreatePlaceholder(container) {
  container.innerHTML = `
    <button class="route-card route-create-placeholder" type="button">
      <span class="route-create-icon">
        <span class="topbar-action-icon topbar-action-icon-plus" aria-hidden="true"></span>
      </span>
      <span class="route-create-copy">
        <strong>添加浏览器配置</strong>
        <small>新建一个独立浏览器身份，并绑定对应代理入口。</small>
      </span>
      <span class="route-create-preview" aria-hidden="true">
        <span>CDP</span>
        <span>Proxy</span>
        <span>Profile</span>
      </span>
      <span class="route-create-action">添加</span>
    </button>
  `;
  container.querySelector(".route-create-placeholder").addEventListener("click", () => openCreateDialog());
}

function setRouteViewMode(mode) {
  routeViewMode = mode === "card" ? "card" : "list";
  localStorage.setItem(ROUTE_VIEW_MODE_KEY, routeViewMode);
  localStorage.removeItem(LEGACY_ROUTE_VIEW_MODE_KEY);
  renderRoutes(currentRoutes);
}

function loadRouteViewMode() {
  const value = localStorage.getItem(ROUTE_VIEW_MODE_KEY) || localStorage.getItem(LEGACY_ROUTE_VIEW_MODE_KEY);
  return value === "card" ? "card" : "list";
}

function syncRouteViewButtons() {
  document.querySelector("#route-view-list").classList.toggle("active", routeViewMode === "list");
  document.querySelector("#route-view-card").classList.toggle("active", routeViewMode === "card");
  document.querySelector("#route-view-list").setAttribute("aria-pressed", routeViewMode === "list" ? "true" : "false");
  document.querySelector("#route-view-card").setAttribute("aria-pressed", routeViewMode === "card" ? "true" : "false");
}

function renderUserDataSelect(select, current) {
  const options = ensureCurrentUserDataDir(current);
  const grouped = new Map();
  for (const entry of options) {
    const groupLabel = entry.rootLabel || (entry.rootPath ? entry.rootPath.split("/").filter(Boolean).at(-1) : "当前路径");
    if (!grouped.has(groupLabel)) grouped.set(groupLabel, []);
    grouped.get(groupLabel).push(entry);
  }
  const managedOption = `
    <option value="" ${current ? "" : "selected"}>新建独立身份</option>
  `;
  const groupedOptions = Array.from(grouped.entries()).map(([groupLabel, entries]) => {
    const optionMarkup = entries.map((entry) => `
      <option value="${escapeAttr(entry.path)}" ${entry.path === current ? "selected" : ""}>
        ${escapeHtml(entry.label || entry.name || entry.path)}
      </option>
    `).join("");
    return `<optgroup label="${escapeAttr(groupLabel)}">${optionMarkup}</optgroup>`;
  }).join("");
  select.innerHTML = `${managedOption}${groupedOptions}`;
  select.disabled = false;
}

function defaultUserDataDirForCreate() {
  return "";
}

function renderProfileDirectorySelect(select, userDataDir, current) {
  if (!userDataDir) {
    select.innerHTML = `<option value="Default" selected>Default</option>`;
    select.disabled = true;
    return;
  }
  const entry = findUserDataDir(userDataDir);
  const options = Array.from(new Set([current, ...(entry?.profileDirectories || ["Default"])].filter(Boolean)));
  select.innerHTML = options.map((name) => `
    <option value="${escapeAttr(name)}" ${name === current ? "selected" : ""}>${escapeHtml(name)}</option>
  `).join("");
  select.disabled = false;
}

function renderNodeSelect(select, current) {
  const options = Array.from(new Set([current, ...mihomoNodes.map((node) => node.name)].filter(Boolean)));
  const placeholder = current ? "" : "<option value=\"\" selected>不绑定节点</option>";
  select.innerHTML = placeholder + options.map((node) => `
    <option value="${escapeAttr(node)}" ${node === current ? "selected" : ""}>${escapeHtml(node)}</option>
  `).join("");
  select.disabled = !mihomoNodes.length;
}

function ensureCurrentUserDataDir(current) {
  const options = [...userDataDirOptions];
  if (current && !options.some((entry) => entry.path === current)) {
    options.unshift({
      name: current.split("/").at(-1),
      label: current,
      path: current,
      profileDirectories: ["Default"]
    });
  }
  return options;
}

function findUserDataDir(path) {
  return userDataDirOptions.find((entry) => entry.path === path);
}

function nextAvailablePort(usedPorts, startPort) {
  let port = startPort;
  while (usedPorts.has(port)) port += 1;
  return port;
}

function suggestCreatePorts(routes) {
  const routeList = Object.values(routes);
  const usedCdpPorts = new Set(routeList.map((route) => Number(route.cdpPort)).filter(Number.isInteger));
  const usedProxyPorts = new Set(
    routeList
      .map((route) => {
        try {
          return Number(new URL(route.proxyUrl).port);
        } catch {
          return null;
        }
      })
      .filter(Number.isInteger)
  );
  return {
    cdpPort: nextAvailablePort(usedCdpPorts, 9222),
    proxyPort: nextAvailablePort(usedProxyPorts, 18101)
  };
}

function routeProxyPort(route) {
  try {
    return Number(new URL(route.proxyUrl).port) || "";
  } catch {
    return "";
  }
}

function findPortConflicts(cdpPort, proxyPort, ignoredRouteKey = "") {
  const conflicts = [];
  for (const route of Object.values(currentRoutes)) {
    if (route.key === ignoredRouteKey) continue;
    if (Number.isInteger(cdpPort) && Number(route.cdpPort) === cdpPort) {
      conflicts.push({ field: "cdp", label: route.label, port: cdpPort });
    }
    let routeProxyPort = null;
    try {
      routeProxyPort = Number(new URL(route.proxyUrl).port);
    } catch {}
    if (Number.isInteger(proxyPort) && Number.isInteger(routeProxyPort) && routeProxyPort === proxyPort) {
      conflicts.push({ field: "proxy", label: route.label, port: proxyPort });
    }
  }
  return conflicts;
}

function setCreatePortHint(selector, state, message) {
  const node = document.querySelector(selector);
  node.dataset.state = state;
  node.textContent = message;
}

function setCreateFieldHint(inputSelector, hintSelector, state, message) {
  const input = document.querySelector(inputSelector);
  const hint = document.querySelector(hintSelector);
  input.classList.toggle("field-input-error", state === "error");
  hint.dataset.state = state;
  hint.textContent = message;
}

function syncCreatePortValidation({ showErrors = createValidationTouched } = {}) {
  const label = document.querySelector("#create-label").value.trim();
  const cdpPort = Number(document.querySelector("#create-cdp").value);
  const proxyPort = Number(document.querySelector("#create-proxy-port").value);
  const userDataDir = document.querySelector("#create-user-data-dir").value.trim();
  const conflicts = findPortConflicts(cdpPort, proxyPort, editingRouteKey);
  const cdpConflict = conflicts.find((item) => item.field === "cdp");
  const proxyConflict = conflicts.find((item) => item.field === "proxy");
  const labelMissing = !label;
  const cdpInvalid = !Number.isInteger(cdpPort) || cdpPort < 1;
  const proxyInvalid = !Number.isInteger(proxyPort) || proxyPort < 1;
  const showCdpError = Boolean(cdpConflict) || (showErrors && cdpInvalid);
  const showProxyError = Boolean(proxyConflict) || (showErrors && proxyInvalid);

  setCreateFieldHint(
    "#create-label",
    "#create-label-hint",
    showErrors && labelMissing ? "error" : "ok",
    showErrors && labelMissing ? "请输入配置名称" : ""
  );
  setCreateFieldHint(
    "#create-user-data-dir",
    "#create-user-data-hint",
    "ok",
    userDataDir ? "" : "默认创建新的独立浏览器身份"
  );

  setCreatePortHint(
    "#create-cdp-hint",
    showCdpError ? "error" : "ok",
    cdpConflict ? `端口已被 ${cdpConflict.label} 占用` : showErrors && cdpInvalid ? "请输入有效端口" : ""
  );
  setCreatePortHint(
    "#create-proxy-hint",
    showProxyError ? "error" : "ok",
    proxyConflict ? `端口已被 ${proxyConflict.label} 占用` : showErrors && proxyInvalid ? "请输入有效端口" : ""
  );
  document.querySelector("#create-cdp").classList.toggle("field-input-error", showCdpError);
  document.querySelector("#create-proxy-port").classList.toggle("field-input-error", showProxyError);

  const submit = document.querySelector("#create-submit");
  const hasConflicts = Boolean(cdpConflict || proxyConflict);
  const hasMissing = labelMissing || cdpInvalid || proxyInvalid;
  if (showErrors && (proxyInvalid || proxyConflict)) {
    setCreateAdvancedExpanded(true);
  }
  submit.disabled = hasConflicts || hasMissing;
  return { hasConflicts, hasMissing, cdpConflict, proxyConflict };
}

async function renderMihomoNodes() {
  const container = document.querySelector("#mihomo-nodes");
  const state = document.querySelector("#mihomo-state");
  const settingsState = document.querySelector("#settings-mihomo-state");
  renderNodeBackendSummary();
  try {
    const data = await api("/api/mihomo/nodes");
    mihomoNodes = data.nodes;
    if (state) state.textContent = "已连接";
    if (settingsState) settingsState.textContent = "已连接";
    renderProxyClientState({ connected: true, nodeCount: mihomoNodes.length });
    renderNodeBackendSummary({ connected: true, nodeCount: mihomoNodes.length });
    const settingsNodeCount = document.querySelector("#settings-node-count");
    if (settingsNodeCount) settingsNodeCount.textContent = mihomoNodes.length;
    document.querySelector("#dashboard-node-count").textContent = mihomoNodes.length;
    if (!mihomoNodes.length) {
      container.textContent = "Mihomo API 已连接，但没有返回可绑定的具体节点。";
      return;
    }
    container.innerHTML = `
      <div class="node-pool">
        ${mihomoNodes.slice(0, 32).map((node) => `<span>${escapeHtml(node.name)}</span>`).join("")}
      </div>
    `;
  } catch (error) {
    if (state) state.textContent = "未连接";
    if (settingsState) settingsState.textContent = "未连接";
    mihomoNodes = [];
    renderProxyClientState({ connected: false, detail: error.message });
    renderNodeBackendSummary({ connected: false, error: error.message });
    const settingsNodeCount = document.querySelector("#settings-node-count");
    if (settingsNodeCount) settingsNodeCount.textContent = "0";
    document.querySelector("#dashboard-node-count").textContent = "0";
    container.innerHTML = `
      <div class="empty-state">
        <strong>当前代理后端未连接</strong>
        <span>浏览器控制台仍可使用；动态切节点需要外部代理客户端或内置 Mihomo 正常运行。</span>
      </div>
    `;
  }
}

function renderRootDialogMode(mode = "discover") {
  rootDialogMode = mode;
  document.querySelector("#root-tab-custom").classList.toggle("active", mode === "custom");
  document.querySelector("#root-tab-discover").classList.toggle("active", mode === "discover");
  document.querySelector("#root-panel-custom").hidden = mode !== "custom";
  document.querySelector("#root-panel-discover").hidden = mode !== "discover";
  document.querySelector("#save-root-dialog").textContent = mode === "custom" ? "添加" : "一键导入";
}

function showRootDialogError(message) {
  const node = document.querySelector("#root-dialog-error");
  node.hidden = false;
  node.textContent = message;
}

function clearRootDialogError() {
  const node = document.querySelector("#root-dialog-error");
  node.hidden = true;
  node.textContent = "";
}

function renderRootCandidates(candidates) {
  const container = document.querySelector("#root-candidate-list");
  if (!candidates.length) {
    container.innerHTML = `
      <div class="empty-state">
        <strong>未发现可导入目录</strong>
        <span>当前只读取本机常见 Chrome 资料位置，可以改用自定义输入。</span>
      </div>
    `;
    return;
  }

  container.innerHTML = candidates.map((candidate) => {
    const description = candidate.alreadyAdded
      ? "已在目录池中"
      : "待导入";
    return `
    <label class="candidate-item" data-disabled="${candidate.alreadyAdded ? "true" : "false"}">
      <input
        type="checkbox"
        value="${escapeAttr(candidate.path)}"
        ${candidate.alreadyAdded ? "disabled" : ""}
        ${candidate.alreadyAdded ? "" : "checked"}
      >
      <div>
        <strong>${escapeHtml(candidate.label)}</strong>
        <span>${escapeHtml(candidate.path)}</span>
        <small>${escapeHtml(description)} · ${escapeHtml(candidate.expandedPath)}</small>
      </div>
    </label>
  `;
  }).join("");
}

async function loadRootCandidates() {
  const container = document.querySelector("#root-candidate-list");
  container.innerHTML = `
    <div class="empty-state">
      <strong>正在读取候选目录</strong>
      <span>会展示本机常见 Chrome 资料位置。</span>
    </div>
  `;
  try {
    const data = await api("/api/user-data-root-candidates");
    renderRootCandidates(data.candidates || []);
  } catch (error) {
    container.innerHTML = `
      <div class="empty-state">
        <strong>读取候选目录失败</strong>
        <span>${escapeHtml(error.message || "请刷新页面或重启本地服务后重试。")}</span>
      </div>
    `;
  }
}

async function refresh(options = {}) {
  const { suppressErrorLog = false, logServiceTransition = true } = options;
  setRefreshBusy(true);
  try {
    const data = await api("/api/status");
    currentAppInfo = data.app || null;
    const diagnosticsData = await api("/api/diagnostics");
    let candidateData = await api("/api/user-data-root-candidates");
    const importedCount = await autoImportRootCandidates(candidateData.candidates || []);
    if (importedCount) {
      candidateData = await api("/api/user-data-root-candidates");
    }
    const profileData = await api("/api/profiles");
    updateServiceState("online", "", { logTransition: logServiceTransition });
    renderSettingsBasics();
    renderDiagnostics(diagnosticsData);
    renderSettingsForm(data.config);
    userDataRoots = profileData.userDataRoots || [];
    userDataDirOptions = profileData.userDataDirs || [];
    renderUserDataRoots();
    await renderMihomoNodes();
    renderStatusSummary(data.routes);
    renderDashboardAlerts(data.routes);
    renderRoutes(data.routes);
    renderDashboardActivityPreview();
    renderGuideReadiness({ routes: data.routes, config: data.config, roots: userDataRoots, nodes: mihomoNodes });
    renderVersionStatus(latestUpdateResult);
    maybeAutoCheckUpdates().catch(() => {});
    openGuideIfNeeded();
    return data;
  } catch (error) {
    updateServiceState("offline", error.message, { logTransition: logServiceTransition });
    if (!suppressErrorLog) pushActivity("error", "刷新状态失败", error.message);
    throw error;
  } finally {
    setRefreshBusy(false);
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function setRefreshBusy(busy) {
  refreshInFlight = busy;
  const button = document.querySelector("#refresh");
  if (!button) return;
  button.disabled = busy;
  button.dataset.state = busy ? "spinning" : "";
  button.dataset.tooltip = busy ? "同步中" : "立即同步";
  button.setAttribute("aria-label", busy ? "同步中" : "立即同步");
}

function setRootScanBusy(busy) {
  rootScanInFlight = busy;
  const button = document.querySelector("#rescan-root-dirs");
  if (!button) return;
  button.disabled = busy;
  button.dataset.state = busy ? "spinning" : "";
  button.dataset.tooltip = busy ? "扫描中" : "重新扫描";
  button.setAttribute("aria-label", busy ? "扫描中" : "重新扫描目录池");
}

async function rescanUserDataRoots() {
  if (rootScanInFlight) return;
  setRootScanBusy(true);
  const minimumSpin = delay(3000);
  try {
    await refresh();
    await minimumSpin;
    pushActivity("success", "目录池扫描完成", `当前 ${userDataRoots.length} 个目录池`);
  } catch (error) {
    await minimumSpin;
    pushActivity("error", "目录池扫描失败", error.message);
  } finally {
    setRootScanBusy(false);
  }
}

async function addUserDataRoot(path) {
  await api("/api/user-data-roots", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path })
  });
  pushActivity("success", `已添加目录池 ${path}`);
}

async function autoImportRootCandidates(candidates) {
  const pending = candidates.filter((candidate) => !candidate.alreadyAdded);
  let imported = 0;
  for (const candidate of pending) {
    try {
      await api("/api/user-data-roots", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: candidate.path })
      });
      imported += 1;
      autoImportFailedRoots.delete(candidate.path);
    } catch (error) {
      if (!autoImportFailedRoots.has(candidate.path)) {
        autoImportFailedRoots.add(candidate.path);
        pushActivity("warn", `自动导入目录池失败 ${candidate.label}`, error.message);
      }
    }
  }
  if (imported) {
    pushActivity("success", `已自动导入目录池 ${imported} 个`);
  }
  return imported;
}

async function openRootDialog() {
  clearRootDialogError();
  document.querySelector("#new-root-path").value = "";
  renderRootDialogMode("discover");
  document.querySelector("#root-dialog").showModal();
  loadRootCandidates();
}

function closeRootDialog() {
  document.querySelector("#root-dialog").close();
}

async function submitRootDialog(event) {
  event.preventDefault();
  clearRootDialogError();

  try {
    if (rootDialogMode === "custom") {
      const path = document.querySelector("#new-root-path").value.trim();
      if (!path) {
        showRootDialogError("请输入目录路径。");
        return;
      }
      await addUserDataRoot(path);
    } else {
      const selectedPaths = Array.from(document.querySelectorAll("#root-candidate-list input[type='checkbox']:checked"))
        .map((input) => input.value.trim())
        .filter(Boolean);
      if (!selectedPaths.length) {
        showRootDialogError("请至少勾选一个候选目录。");
        return;
      }
      for (const path of selectedPaths) {
        await addUserDataRoot(path);
      }
    }

    closeRootDialog();
    await refresh();
  } catch (error) {
    showRootDialogError(error.message);
  }
}

async function openCreateDialog(routeKey = "") {
  const dialog = document.querySelector("#create-dialog");
  const route = routeKey ? currentRoutes[routeKey] : null;
  editingRouteKey = route?.key || "";
  createValidationTouched = false;
  clearCreateError();
  setCreateAdvancedExpanded(false);
  document.querySelector("#create-dialog-title").textContent = route ? "编辑浏览器配置" : "添加浏览器配置";
  document.querySelector("#create-submit").textContent = route ? "保存" : "保存";
  document.querySelector("#create-label").value = route?.label || "";
  document.querySelector("#create-start-url").value = route?.startUrl || "";
  const suggestedPorts = suggestCreatePorts(currentRoutes);
  document.querySelector("#create-cdp").value = route?.cdpPort || suggestedPorts.cdpPort;
  document.querySelector("#create-proxy-port").value = route ? routeProxyPort(route) : suggestedPorts.proxyPort;
  renderUserDataSelect(
    document.querySelector("#create-user-data-dir"),
    route?.userDataDir || route?.profileDir || defaultUserDataDirForCreate()
  );
  renderProfileDirectorySelect(
    document.querySelector("#create-profile-directory"),
    document.querySelector("#create-user-data-dir").value,
    route?.profileDirectory || "Default"
  );
  renderNodeSelect(document.querySelector("#create-node"), route?.nodeName || "");
  syncCreatePortValidation({ showErrors: false });
  dialog.showModal();
}

function closeCreateDialog() {
  editingRouteKey = "";
  document.querySelector("#create-dialog").close();
}

function openGuideDialog() {
  document.querySelector("#guide-dialog").showModal();
}

function closeGuideDialog() {
  markGuideDismissed();
  document.querySelector("#guide-dialog").close();
}

async function openExportDialog() {
  document.querySelector("#export-dialog").showModal();
  await refreshExportPreview();
}

function closeExportDialog() {
  document.querySelector("#export-dialog").close();
}

async function refreshExportPreview() {
  const preview = document.querySelector("#export-json-preview");
  preview.value = "正在生成团队配置模板...";
  try {
    exportTemplateCache = await api("/api/team-template");
    preview.value = JSON.stringify(exportTemplateCache, null, 2);
  } catch (error) {
    preview.value = "";
    pushActivity("error", "导出配置失败", error.message);
  }
}

async function copyExportJson() {
  const value = document.querySelector("#export-json-preview").value.trim();
  if (!value) return;
  await copyTextValue(value, document.querySelector("#export-json-preview"));
  pushActivity("success", "已复制团队配置 JSON");
}

async function copyInputValue(selector, successTitle) {
  const input = document.querySelector(selector);
  const value = input?.value.trim();
  if (!value) return;
  await copyTextValue(value, input);
  pushActivity("success", successTitle, value);
}

async function copyTextValue(value, fallbackInput = null) {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    if (!fallbackInput) return;
    fallbackInput.focus();
    fallbackInput.select();
    document.execCommand("copy");
  }
}

function downloadExportJson() {
  const value = document.querySelector("#export-json-preview").value.trim();
  if (!value) return;
  const blob = new Blob([`${value}\n`], { type: "application/json;charset=utf-8" });
  const link = document.createElement("a");
  const date = new Date().toISOString().slice(0, 10);
  link.href = URL.createObjectURL(blob);
  link.download = `md-browser-team-template-${date}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
  pushActivity("success", "已下载团队配置 JSON");
}

function downloadJsonFile(value, fileName) {
  const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: "application/json;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}

async function downloadSupportBundle() {
  const bundle = await api("/api/support-bundle");
  const date = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  downloadJsonFile(bundle, `md-browser-support-${date}.json`);
  pushActivity("success", "已导出排障包", "排障包已脱敏，可发给负责人定位问题。");
}

async function checkUpdates() {
  const button = document.querySelector("#check-updates");
  const previous = button.textContent;
  button.disabled = true;
  button.textContent = "检查中...";
  renderUpdateDialog({ loading: true });
  openUpdateDialog();
  try {
    const result = await api("/api/update-check");
    saveLatestUpdateResult(result);
    renderUpdateDialog(latestUpdateResult);
    if (!result.configured) {
      pushActivity("warn", "未配置更新地址", "需要设置 release manifest 地址后才能检查更新。");
      return;
    }
    if (result.updateAvailable) {
      pushActivity("success", "发现新版本", `当前 v${result.currentVersion}，最新 v${result.latestVersion}`);
    } else {
      pushActivity("success", "已是最新版本", `当前 v${result.currentVersion}`);
    }
    renderDashboardAlerts(currentRoutes);
  } catch (error) {
    saveLatestUpdateResult({ error: error.message });
    renderUpdateDialog(latestUpdateResult);
    openUpdateDialog();
    pushActivity("error", "检查更新失败", error.message);
  } finally {
    button.disabled = false;
    button.textContent = previous;
  }
}

function openUpdateDialog() {
  openDialogCompat("#update-dialog");
}

function closeUpdateDialog() {
  closeDialogCompat("#update-dialog");
}

function renderUpdateDialog(result = {}) {
  const container = document.querySelector("#update-result");
  const downloadButton = document.querySelector("#open-update-download");
  if (!container || !downloadButton) return;

  if (result.loading) {
    downloadButton.hidden = true;
    downloadButton.dataset.url = "";
    container.innerHTML = `
      <article class="update-status-card">
        <div class="update-status-topline">
          <strong>正在检查更新</strong>
          <span class="update-status-badge" data-tone="info">处理中</span>
        </div>
        <p>正在读取最新版本信息，请稍候。</p>
      </article>
    `;
    return;
  }

  if (result.error) {
    downloadButton.hidden = true;
    downloadButton.dataset.url = "";
    container.innerHTML = `
      <article class="update-status-card">
        <div class="update-status-topline">
          <strong>检查更新失败</strong>
          <span class="update-status-badge" data-tone="error">未完成</span>
        </div>
        <p>${escapeHtml(result.error)}</p>
      </article>
    `;
    return;
  }

  const configured = result.configured !== false;
  const tone = !configured ? "warn" : result.updateAvailable ? "info" : "success";
  const statusText = !configured
    ? "未配置"
    : result.updateAvailable
      ? "发现新版本"
      : "已是最新";
  const summary = !configured
    ? "当前还没有可用的版本清单地址。"
    : result.updateAvailable
      ? `检测到可更新版本 v${result.latestVersion}。`
      : `当前客户端 v${result.currentVersion} 已是最新版本。`;
  const notes = Array.isArray(result.notes) ? result.notes.filter(Boolean) : [];

  downloadButton.hidden = !(result.updateAvailable && result.downloadUrl);
  downloadButton.dataset.url = result.downloadUrl || "";

  container.innerHTML = `
    <article class="update-status-card">
      <div class="update-status-topline">
        <strong>${escapeHtml(statusText)}</strong>
        <span class="update-status-badge" data-tone="${escapeAttr(tone)}">${escapeHtml(statusText)}</span>
      </div>
      <p>${escapeHtml(summary)}</p>
      ${result.manifestUrl ? `<small>更新源：${escapeHtml(result.manifestUrl)}</small>` : ""}
    </article>
    <section class="update-version-grid">
      <article>
        <span>当前版本</span>
        <strong>v${escapeHtml(result.currentVersion || currentAppInfo?.version || "-")}</strong>
      </article>
      <article>
        <span>最新版本</span>
        <strong>v${escapeHtml(result.latestVersion || result.currentVersion || currentAppInfo?.version || "-")}</strong>
      </article>
    </section>
    ${(notes.length || result.fileName || result.sha256) ? `
      <section class="update-notes-card">
        <strong>版本信息</strong>
        ${result.fileName ? `<small>安装包：${escapeHtml(result.fileName)}</small>` : ""}
        ${result.sha256 ? `<small>SHA-256：<code>${escapeHtml(result.sha256)}</code></small>` : ""}
        ${notes.length ? `<ul>${notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ul>` : ""}
      </section>
    ` : ""}
  `;
}

async function openChangelogDialog() {
  const button = document.querySelector("#view-changelog");
  const previous = button?.textContent || "";
  if (button) {
    button.disabled = true;
    button.textContent = "读取中...";
  }
  try {
    if (!changelogEntries.length) {
      const result = await api("/api/changelog");
      changelogEntries = result.entries || [];
    }
    renderChangelogDialog(changelogEntries);
    openDialogCompat("#changelog-dialog");
  } catch (error) {
    renderChangelogDialog([], error.message);
    openDialogCompat("#changelog-dialog");
    pushActivity("error", "读取更新记录失败", error.message);
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = previous;
    }
  }
}

function closeChangelogDialog() {
  closeDialogCompat("#changelog-dialog");
}

function renderChangelogDialog(entries = [], errorMessage = "") {
  const container = document.querySelector("#changelog-list");
  if (!container) return;
  if (errorMessage) {
    container.innerHTML = `
      <div class="empty-state">
        <strong>读取更新记录失败</strong>
        <span>${escapeHtml(errorMessage)}</span>
      </div>
    `;
    return;
  }
  if (!entries.length) {
    container.innerHTML = `
      <div class="empty-state">
        <strong>暂无更新记录</strong>
        <span>当前还没有可展示的版本说明。</span>
      </div>
    `;
    return;
  }

  container.innerHTML = entries.map((entry) => `
    <article class="changelog-entry">
      <div class="changelog-entry-header">
        <div class="changelog-entry-meta">
          <strong>${escapeHtml(entry.version || "-")}</strong>
          <span>${escapeHtml(entry.date || "")}</span>
        </div>
        ${releaseDownloadUrl(entry.version) ? `
          <button class="button ghost changelog-download-button" type="button" data-version="${escapeAttr(entry.version || "")}">
            下载此版本
          </button>
        ` : ""}
      </div>
      ${(entry.sections || []).map((section) => `
        <section class="changelog-section">
          <h4>${escapeHtml(section.title || "")}</h4>
          <ul>${(section.items || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
        </section>
      `).join("")}
    </article>
  `).join("");
}

function openImportDialog() {
  clearImportError();
  document.querySelector("#import-json-input").value = "";
  renderImportPreview(null);
  document.querySelector("#import-dialog").showModal();
}

function closeImportDialog() {
  document.querySelector("#import-dialog").close();
}

function clearImportError() {
  const node = document.querySelector("#import-error");
  node.hidden = true;
  node.textContent = "";
}

function showImportError(message) {
  const node = document.querySelector("#import-error");
  node.hidden = false;
  node.textContent = message;
}

function parseImportTemplate() {
  const raw = document.querySelector("#import-json-input").value.trim();
  if (!raw) throw new Error("请先粘贴团队配置 JSON。");
  const template = JSON.parse(raw);
  if (!template || template.type !== "md-browser.team-template") {
    throw new Error("不是 MD-Browser 团队配置模板。");
  }
  if (Number(template.version) !== 1) {
    throw new Error(`不支持的模板版本：${template.version}`);
  }
  if (!Array.isArray(template.configs) || !template.configs.length) {
    throw new Error("模板中没有可导入的浏览器配置。");
  }
  return template;
}

function previewImportTemplate() {
  clearImportError();
  try {
    const template = parseImportTemplate();
    renderImportPreview(template);
  } catch (error) {
    renderImportPreview(null);
    showImportError(error.message);
  }
}

function renderImportPreview(template) {
  const container = document.querySelector("#import-preview");
  if (!template) {
    container.innerHTML = `
      <div class="empty-state">
        <strong>等待预览</strong>
        <span>粘贴 JSON 后点击预览，系统会检查节点匹配情况。</span>
      </div>
    `;
    return;
  }
  const nodeNames = new Set(mihomoNodes.map((node) => node.name));
  container.innerHTML = template.configs.map((item) => {
    const name = String(item.name || "未命名配置").trim();
    const expectedNode = String(item.expectedNode || "").trim();
    const nodeState = expectedNode ? (nodeNames.has(expectedNode) ? "matched" : "missing") : "unbound";
    const nodeText = expectedNode ? (nodeState === "matched" ? "节点已匹配" : "节点待绑定") : "未指定节点";
    const url = String(item.startUrl || "默认 Google 首页").trim();
    return `
      <article class="import-preview-item">
        <div>
          <strong>${escapeHtml(name)}</strong>
          <small>节点：${escapeHtml(expectedNode || "未指定")} · 网址：${escapeHtml(url || "默认 Google 首页")}</small>
        </div>
        <span class="import-node-state" data-state="${escapeAttr(nodeState)}">${escapeHtml(nodeText)}</span>
      </article>
    `;
  }).join("");
}

async function submitImportTemplate(event) {
  event.preventDefault();
  clearImportError();
  try {
    const template = parseImportTemplate();
    renderImportPreview(template);
    const result = await api("/api/team-template/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ template })
    });
    const missing = result.results.filter((item) => item.nodeState === "missing").length;
    const bound = result.results.filter((item) => item.nodeState === "bound").length;
    pushActivity("success", `已导入团队配置 ${result.imported} 个`, `节点已绑定 ${bound} 个，待绑定 ${missing} 个`);
    warnIfProxyReloadFailed(result.reload, "团队配置导入");
    closeImportDialog();
    await refresh();
  } catch (error) {
    showImportError(error.message);
    pushActivity("error", "导入团队配置失败", error.message);
  }
}

async function createRouteConfig(event) {
  event.preventDefault();
  createValidationTouched = true;
  clearCreateError();
  const validation = syncCreatePortValidation();
  if (validation.hasConflicts || validation.hasMissing) {
    return;
  }
  const userDataDir = document.querySelector("#create-user-data-dir").value.trim();
  const proxyPort = Number(document.querySelector("#create-proxy-port").value);
  const profileDirectory = document.querySelector("#create-profile-directory").value.trim() || "Default";
  const route = {
    label: document.querySelector("#create-label").value.trim(),
    startUrl: document.querySelector("#create-start-url").value.trim(),
    cdpPort: Number(document.querySelector("#create-cdp").value),
    proxyUrl: `http://127.0.0.1:${proxyPort}`,
    profileName: userDataDir ? userDataDir.split("/").at(-1) : document.querySelector("#create-label").value.trim()
  };
  if (userDataDir) {
    route.userDataDir = userDataDir;
    route.profileDirectory = profileDirectory;
  } else {
    route.userDataDir = "";
    route.profileDirectory = "Default";
  }

  try {
    const selectedNode = document.querySelector("#create-node").value.trim();
    let routeKey = editingRouteKey;
    let routeLabel = route.label || currentRoutes[routeKey]?.label || routeKey;
    const response = await api(editingRouteKey ? `/api/routes/${encodeURIComponent(editingRouteKey)}` : "/api/routes", {
      method: editingRouteKey ? "PATCH" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(route)
    });
    if (!routeKey) routeKey = response.routeKey;
    routeLabel = route.label || currentRoutes[routeKey]?.label || routeKey;

    if (selectedNode && selectedNode !== currentRoutes[routeKey]?.nodeName) {
      const bindResult = await api(`/api/routes/${encodeURIComponent(routeKey)}/node`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ node: selectedNode })
      });
      warnIfProxyReloadFailed(bindResult, routeLabel);
    }

    pushActivity("success", editingRouteKey ? `已保存配置 ${routeLabel}` : `已创建配置 ${routeLabel}`, "", { routeKey, routeLabel });
    closeCreateDialog();
    await refresh();
  } catch (error) {
    showCreateError(error.message);
    pushActivity("error", `${editingRouteKey ? "保存" : "创建"}配置失败 ${route.label || "未命名配置"}`, error.message);
  }
}

async function deleteRouteConfig(key, label) {
  const confirmed = window.confirm(`删除配置“${label}”后不会自动恢复。继续吗？`);
  if (!confirmed) return;
  const result = await api(`/api/routes/${encodeURIComponent(key)}`, { method: "DELETE" });
  pushActivity("warn", `已删除配置 ${label}`, "", { routeKey: key, routeLabel: label });
  warnIfProxyReloadFailed(result, label);
  await refresh();
}

function warnIfProxyReloadFailed(result, label = "") {
  if (!result || result.reloaded !== false || !result.error) return;
  pushActivity(
    "warn",
    "代理配置已保存，重载未完成",
    `${label ? `${label} · ` : ""}${result.error}`
  );
}

async function removeUserDataRoot(path) {
  await api("/api/user-data-roots", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path })
  });
  pushActivity("warn", `已移除目录池 ${path}`);
  await refresh();
}

async function launchRoute(key) {
  const label = currentRoutes[key]?.label || key;
  pendingLaunchKeys.add(key);
  renderRoutes(currentRoutes);
  pushActivity("info", `开始启动 ${label}`, `CDP ${currentRoutes[key]?.cdpPort || "-"}`, { routeKey: key, routeLabel: label });

  try {
    const result = await api(`/api/routes/${encodeURIComponent(key)}/launch`, { method: "POST" });
    pushActivity(
      "success",
      result.alreadyRunning ? `${label} 已在运行` : `${label} 启动命令已发送`,
      result.cdpPort ? `CDP ${result.cdpPort}` : "",
      { routeKey: key, routeLabel: label }
    );
    setTimeout(async () => {
      try {
        const data = await refresh({ suppressErrorLog: true });
        const route = data?.routes?.[key];
        if (route) {
          pushActivity("info", `${label} 当前状态`, routeState(route).label, { routeKey: key, routeLabel: label });
        }
      } catch {}
    }, 900);
  } catch (error) {
    if (await handleCdpPortConflict(error, key, label)) return;
    pushActivity("error", `启动失败 ${label}`, error.message, { routeKey: key, routeLabel: label });
  } finally {
    pendingLaunchKeys.delete(key);
    renderRoutes(currentRoutes);
  }
}

function formatPortProcesses(processes = []) {
  if (!processes.length) return "未识别到具体占用进程";
  return processes.map((item) => `${item.command || "未知进程"} PID ${item.pid}`).join("、");
}

async function handleCdpPortConflict(error, key, label) {
  const payload = error.payload || {};
  if ((error.code || payload.code) !== "CDP_PORT_CONFLICT") return false;
  const port = error.port || payload.port || currentRoutes[key]?.cdpPort;
  const processes = error.processes || payload.processes || [];
  const processText = formatPortProcesses(processes);

  pushActivity(
    "error",
    `启动失败 ${label}`,
    `CDP ${port} 已被占用，MD-Browser 不会关闭其他浏览器。${processText}`,
    { routeKey: key, routeLabel: label }
  );
  return true;
}

async function stopRoute(key) {
  const label = currentRoutes[key]?.label || key;
  pendingLaunchKeys.add(key);
  renderRoutes(currentRoutes);
  pushActivity("info", `开始关闭 ${label}`, `CDP ${currentRoutes[key]?.cdpPort || "-"}`, { routeKey: key, routeLabel: label });

  try {
    const result = await api(`/api/routes/${encodeURIComponent(key)}/stop`, { method: "POST" });
    pushActivity(
      "success",
      `${label} 已关闭`,
      result.cdpPort ? `CDP ${result.cdpPort}` : "",
      { routeKey: key, routeLabel: label }
    );
    setTimeout(() => {
      refresh({ suppressErrorLog: true }).catch(() => {});
    }, 700);
  } catch (error) {
    pushActivity("error", `关闭失败 ${label}`, error.message, { routeKey: key, routeLabel: label });
  } finally {
    pendingLaunchKeys.delete(key);
    renderRoutes(currentRoutes);
  }
}

async function foregroundChrome(routeKey = "", routeLabel = "") {
  try {
    const result = await api(`/api/routes/${encodeURIComponent(routeKey)}/foreground`, { method: "POST" });
    pushActivity(
      "info",
      routeLabel ? `已显示窗口 ${routeLabel}` : "已显示 Chrome 窗口",
      result.matchedTitle ? `匹配窗口：${result.matchedTitle}` : "",
      routeKey ? { routeKey, routeLabel } : {}
    );
  } catch (error) {
    pushActivity(
      "error",
      routeLabel ? `显示窗口失败 ${routeLabel}` : "显示窗口失败",
      error.message,
      routeKey ? { routeKey, routeLabel } : {}
    );
  }
}

function formatSubtitle(route) {
  if (route.country) return route.country;
  try {
    return new URL(route.startUrl || "https://www.google.com/").hostname;
  } catch {
    return route.key;
  }
}

function routeInitials(label) {
  const clean = String(label || "").trim();
  if (!clean) return "ENV";
  return Array.from(clean).slice(0, 2).join("").toUpperCase();
}

function matchesRouteFilters(route) {
  const state = routeState(route);
  if (routeStateFilter === "ready" && state.tone !== "ready") return false;
  if (routeStateFilter === "unavailable" && state.tone !== "unavailable") return false;
  if (routeStateFilter === "browser-running" && !state.browserReady) return false;
  if (routeStateFilter === "browser-stopped" && state.browserReady) return false;
  if (routeStateFilter === "proxy-offline" && !state.issues.includes("代理离线")) return false;
  if (routeStateFilter === "node-issue" && !route.nodeStatus) return false;
  if (routeStateFilter === "node-issue" && route.nodeStatus.valid !== false) return false;
  if (!routeSearchQuery) return true;
  const haystack = [
    route.label,
    route.country,
    route.key,
    route.nodeName,
    route.userDataDirName,
    route.userDataDir,
    route.startUrl,
    ...(route.tags || [])
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(routeSearchQuery);
}

function showCreateError(message) {
  const node = document.querySelector("#create-error");
  node.hidden = false;
  node.textContent = message;
}

function clearCreateError() {
  const node = document.querySelector("#create-error");
  node.hidden = true;
  node.textContent = "";
}

function pushActivity(level, message, detail = "", options = {}) {
  const category = options.category || inferActivityCategory(message, detail, options);
  activityLog = [
    {
      id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      level,
      category,
      message,
      detail,
      time: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
      routeKey: options.routeKey || "",
      routeLabel: options.routeLabel || ""
    },
    ...activityLog
  ].slice(0, 200);
  renderActivityLog();
}

function inferActivityCategory(message, detail = "", options = {}) {
  if (options.routeKey) return "browser";
  const text = `${message} ${detail}`.toLowerCase();
  if (/更新|版本|release|manifest/.test(text)) return "update";
  if (/mcp|agent|codex|claude/.test(text)) return "agent";
  if (/节点|代理|mihomo|订阅|listener/.test(text)) return "proxy";
  if (/浏览器|cdp|前台|启动|关闭/.test(text)) return "browser";
  if (/配置|目录池|保存|导入|导出/.test(text)) return "config";
  return "system";
}

function getActivityLevelLabel(level) {
  if (level === "success") return "成功";
  if (level === "error") return "错误";
  if (level === "warn") return "警告";
  return "记录";
}

function renderActivityLog() {
  const container = document.querySelector("#activity-log");
  const filteredLog = activityCategoryFilter === "all"
    ? activityLog
    : activityLog.filter((entry) => entry.category === activityCategoryFilter);
  document.querySelector("#activity-filter-label").textContent = `当前范围：${activityFilterLabel}`;
  const countBadge = document.querySelector(".activity-count-badge");
  if (countBadge) countBadge.textContent = `${filteredLog.length} 条`;
  syncActivityCategoryButtons();

  if (!filteredLog.length) {
    container.innerHTML = `
      <div class="empty-state">
        <strong>暂无日志</strong>
        <span>当前分类下还没有记录。</span>
      </div>
    `;
    return;
  }

  container.innerHTML = filteredLog.map((entry) => `
    <article class="activity-entry" data-level="${escapeAttr(entry.level)}">
      <div class="activity-entry-grid">
        <div class="activity-entry-main">
          <strong>${escapeHtml(entry.message)}</strong>
          ${entry.detail ? `<p>${escapeHtml(entry.detail)}</p>` : ""}
        </div>
        <div class="activity-entry-side">
          <span class="activity-entry-level">${escapeHtml(getActivityLevelLabel(entry.level))} · ${escapeHtml(getActivityCategoryLabel(entry.category))}</span>
          <time>${escapeHtml(entry.time)}</time>
        </div>
      </div>
    </article>
  `).join("");
  renderDashboardActivityPreview();
}

function getActivityCategoryLabel(category) {
  if (category === "browser") return "浏览器";
  if (category === "proxy") return "代理";
  if (category === "config") return "配置";
  if (category === "update") return "更新";
  if (category === "agent") return "Agent";
  return "系统";
}

function setActivityCategoryFilter(category = "all") {
  activityCategoryFilter = category;
  activityFilterLabel = category === "all" ? "全部日志" : `${getActivityCategoryLabel(category)}日志`;
  renderActivityLog();
}

function syncActivityCategoryButtons() {
  document.querySelectorAll(".activity-filter-chip").forEach((button) => {
    button.classList.toggle("active", button.dataset.category === activityCategoryFilter);
  });
}

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll('"', "&quot;");
}

document.querySelector("#refresh")?.addEventListener("click", refresh);
document.querySelector("#rescan-root-dirs").addEventListener("click", rescanUserDataRoots);
document.querySelector("#open-root-dialog").addEventListener("click", openRootDialog);
document.querySelector("#close-root-dialog").addEventListener("click", closeRootDialog);
document.querySelector("#cancel-root-dialog").addEventListener("click", closeRootDialog);
document.querySelector("#root-dialog-form").addEventListener("submit", submitRootDialog);
document.querySelector("#root-tab-custom").addEventListener("click", () => {
  clearRootDialogError();
  renderRootDialogMode("custom");
});
document.querySelector("#root-tab-discover").addEventListener("click", async () => {
  clearRootDialogError();
  renderRootDialogMode("discover");
  loadRootCandidates();
});
document.querySelector("#export-template").addEventListener("click", openExportDialog);
document.querySelector("#close-export-dialog").addEventListener("click", closeExportDialog);
document.querySelector("#refresh-export-preview").addEventListener("click", refreshExportPreview);
document.querySelector("#copy-export-json").addEventListener("click", copyExportJson);
document.querySelector("#download-export-json").addEventListener("click", downloadExportJson);
document.querySelector("#import-template").addEventListener("click", openImportDialog);
document.querySelector("#close-import-dialog").addEventListener("click", closeImportDialog);
document.querySelector("#preview-import-json").addEventListener("click", previewImportTemplate);
document.querySelector("#import-template-form").addEventListener("submit", submitImportTemplate);
document.querySelector("#toggle-proxy-advanced").addEventListener("click", () => {
  const section = document.querySelector("#proxy-advanced-settings");
  setProxyAdvancedExpanded(section.hidden);
});
document.querySelector("#toggle-embedded-advanced").addEventListener("click", () => {
  const section = document.querySelector("#embedded-advanced-settings");
  setEmbeddedAdvancedExpanded(section.hidden);
});
document.querySelector("#toggle-external-proxy").addEventListener("click", () => {
  toggleExternalProxy().catch((error) => pushActivity("error", "外部代理切换失败", error.message));
});
document.querySelector("#toggle-embedded-mihomo").addEventListener("click", () => {
  toggleEmbeddedMihomo().catch((error) => pushActivity("error", "内置 Mihomo 切换失败", error.message));
});
document.querySelector("#repair-embedded-mihomo").addEventListener("click", () => {
  repairEmbeddedMihomo().catch((error) => pushActivity("error", "内置 Mihomo 修复失败", error.message));
});
document.querySelector("#configure-embedded-subscription").addEventListener("click", openEmbeddedSubscriptionDialog);
document.querySelector("#close-embedded-subscription-dialog").addEventListener("click", closeEmbeddedSubscriptionDialog);
document.querySelector("#cancel-embedded-subscription").addEventListener("click", closeEmbeddedSubscriptionDialog);
document.querySelector("#save-embedded-subscription").addEventListener("click", () => {
  saveEmbeddedSubscription().catch((error) => setEmbeddedSubscriptionError(error.message));
});
document.querySelector("#embedded-subscription-form").addEventListener("submit", (event) => {
  event.preventDefault();
  saveEmbeddedSubscription({ startAfter: true }).catch((error) => setEmbeddedSubscriptionError(error.message));
});
document.querySelector("#detect-proxy-client").addEventListener("click", detectProxyClient);
document.querySelector("#choose-proxy-client").addEventListener("click", openProxyClientDialog);
document.querySelector("#close-proxy-client-dialog").addEventListener("click", closeProxyClientDialog);
document.querySelector("#choose-browser").addEventListener("click", openBrowserDialog);
document.querySelector("#close-browser-dialog").addEventListener("click", closeBrowserDialog);
document.querySelector("#copy-local-url").addEventListener("click", () => {
  copyInputValue("#settings-local-url", "已复制本地页面地址").catch((error) => pushActivity("error", "复制本地页面地址失败", error.message));
});
document.querySelector("#copy-mcp-message").addEventListener("click", () => {
  copyInputValue("#settings-mcp-message", "已复制 MCP 安装话术").catch((error) => pushActivity("error", "复制 MCP 安装话术失败", error.message));
});
document.querySelector("#open-feedback-issues").addEventListener("click", () => {
  const url = issueFeedbackUrl();
  const button = document.querySelector("#open-feedback-issues");
  if (!url) {
    pushActivity("error", "未找到反馈地址", "当前版本没有配置 GitHub Issues 地址。");
    return;
  }
  const previous = button?.textContent || "";
  if (button) {
    button.disabled = true;
    button.textContent = "打开中...";
  }
  openExternalUrl(url)
    .then(async (opened) => {
      if (opened) {
        pushActivity("success", "已打开反馈页面", url);
        return;
      }
      await copyTextValue(url);
      pushActivity("warn", "无法直接打开反馈页面", "已自动复制反馈地址，请手动打开。");
    })
    .catch(async () => {
      try {
        await copyTextValue(url);
        pushActivity("warn", "无法直接打开反馈页面", "已自动复制反馈地址，请手动打开。");
      } catch (error) {
        pushActivity("error", "打开反馈页面失败", error.message || "当前环境不允许直接打开外部链接。");
      }
    })
    .finally(() => {
      if (button) {
        button.disabled = false;
        button.textContent = previous;
      }
    });
});
document.querySelector("#check-updates").addEventListener("click", () => {
  checkUpdates().catch((error) => pushActivity("error", "检查更新失败", error.message));
});
document.querySelector("#view-changelog").addEventListener("click", () => {
  openChangelogDialog().catch((error) => pushActivity("error", "读取更新记录失败", error.message));
});
document.querySelector("#download-support-bundle").addEventListener("click", () => {
  downloadSupportBundle().catch((error) => pushActivity("error", "导出排障包失败", error.message));
});
document.querySelector("#close-update-dialog").addEventListener("click", closeUpdateDialog);
document.querySelector("#open-changelog-from-update").addEventListener("click", () => {
  closeUpdateDialog();
  openChangelogDialog().catch((error) => pushActivity("error", "读取更新记录失败", error.message));
});
document.querySelector("#open-update-download").addEventListener("click", (event) => {
  const url = event.currentTarget.dataset.url || "";
  if (!url) return;
  openExternalUrl(url).then((opened) => {
    if (!opened) {
      pushActivity("error", "打开下载地址失败", "当前环境不允许直接打开外部链接。");
    }
  });
});
document.querySelector("#close-changelog-dialog").addEventListener("click", closeChangelogDialog);
document.querySelector("#changelog-list").addEventListener("click", (event) => {
  const button = event.target.closest(".changelog-download-button");
  if (!button) return;
  const version = button.dataset.version || "";
  openVersionDownload(version).catch((error) => pushActivity("error", "打开版本下载失败", error.message));
});
document.querySelector("#toggle-local-advanced").addEventListener("click", () => {
  const section = document.querySelector("#local-advanced-settings");
  setLocalAdvancedExpanded(section.hidden);
});
document.querySelector("#create-route").addEventListener("click", openCreateDialog);
document.querySelector("#close-create-dialog").addEventListener("click", closeCreateDialog);
document.querySelector("#toggle-create-advanced").addEventListener("click", () => {
  setCreateAdvancedExpanded(!createAdvancedExpanded);
});
document.querySelector("#collapse-create-advanced").addEventListener("click", () => {
  setCreateAdvancedExpanded(false);
});
document.querySelector("#cancel-create-route").addEventListener("click", closeCreateDialog);
document.querySelector("#clear-activity-log").addEventListener("click", () => {
  activityLog = [];
  renderActivityLog();
});
document.querySelector("#open-guide-dialog").addEventListener("click", openGuideDialog);
document.querySelector("#open-guide-inline").addEventListener("click", openGuideDialog);
document.querySelector("#close-guide-dialog").addEventListener("click", closeGuideDialog);
document.querySelector("#route-filter-node-issues").addEventListener("click", () => {
  routeStateFilter = "node-issue";
  document.querySelector("#route-state-filter").value = "node-issue";
  renderRoutes(currentRoutes);
});
document.querySelector("#route-clear-filters").addEventListener("click", () => {
  routeStateFilter = "all";
  routeSearchQuery = "";
  document.querySelector("#route-state-filter").value = "all";
  document.querySelector("#route-search").value = "";
  renderRoutes(currentRoutes);
});
document.querySelectorAll(".activity-filter-chip").forEach((button) => {
  button.addEventListener("click", () => setActivityCategoryFilter(button.dataset.category || "all"));
});
document.querySelector("#open-proxy-settings").addEventListener("click", () => {
  window.location.hash = "settings";
  window.setTimeout(() => {
    document.querySelector("#proxy-settings-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, 80);
});
document.querySelectorAll("[data-target-page]").forEach((button) => {
  button.addEventListener("click", () => {
    closeGuideDialog();
    window.location.hash = button.dataset.targetPage;
    if (button.dataset.targetAction === "proxy-settings") {
      window.setTimeout(() => {
        document.querySelector("#proxy-settings-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 80);
    }
    if (button.dataset.targetAction === "agent-settings") {
      window.setTimeout(() => {
        document.querySelector("#agent-settings-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 80);
    }
  });
});
document.querySelector("#create-route-form").addEventListener("submit", createRouteConfig);
document.querySelector("#settings-form").addEventListener("submit", saveSystemSettings);
document.querySelectorAll("#settings-form input").forEach((input) => {
  input.addEventListener("input", () => {
    if (input.matches("[data-embedded-subscription-input]")) syncEmbeddedSubscriptionInputs(input);
    markSettingsDirty();
  });
  input.addEventListener("change", () => {
    if (input.matches("[data-embedded-subscription-input]")) syncEmbeddedSubscriptionInputs(input);
    markSettingsDirty();
  });
});
document.querySelector("#route-search").addEventListener("input", (event) => {
  routeSearchQuery = event.currentTarget.value.trim().toLowerCase();
  renderRoutes(currentRoutes);
});
document.querySelector("#route-state-filter").addEventListener("change", (event) => {
  routeStateFilter = event.currentTarget.value;
  renderRoutes(currentRoutes);
});
document.querySelector("#route-view-list").addEventListener("click", () => setRouteViewMode("list"));
document.querySelector("#route-view-card").addEventListener("click", () => setRouteViewMode("card"));
document.querySelector("#create-label").addEventListener("input", syncCreatePortValidation);
document.querySelector("#create-cdp").addEventListener("input", syncCreatePortValidation);
document.querySelector("#create-proxy-port").addEventListener("input", syncCreatePortValidation);
document.querySelector("#create-user-data-dir").addEventListener("change", (event) => {
  renderProfileDirectorySelect(document.querySelector("#create-profile-directory"), event.currentTarget.value, "Default");
  syncCreatePortValidation();
});
window.addEventListener("hashchange", syncPageFromHash);

syncPageFromHash();
renderSettingsBasics();
setProxyAdvancedExpanded(false);
setLocalAdvancedExpanded(false);
renderActivityLog();
refresh().then(() => {
  pushActivity("info", "页面已连接", "配置与节点状态已加载");
}).catch(() => {});
setInterval(() => {
  refresh({ suppressErrorLog: true }).catch(() => {});
}, 15000);
