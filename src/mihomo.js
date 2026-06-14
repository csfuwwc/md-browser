import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export function buildHeaders(mihomoConfig) {
  const headers = { "content-type": "application/json" };
  if (mihomoConfig.secret) headers.Authorization = `Bearer ${mihomoConfig.secret}`;
  return headers;
}

export async function listGroups(mihomoConfig, { fetchImpl = fetch } = {}) {
  const response = await fetchMihomoApi(mihomoConfig, "/proxies", { fetchImpl });
  if (!response.ok) {
    throw await mihomoApiError(response, "Mihomo API failed");
  }
  const data = await response.json();
  const groups = Object.entries(data.proxies || {})
    .filter(([, proxy]) => Array.isArray(proxy.all))
    .map(([name, proxy]) => ({
      name,
      now: proxy.now,
      all: proxy.all,
      type: proxy.type
    }));
  return { groups };
}

export async function listNodes(mihomoConfig, { fetchImpl = fetch } = {}) {
  const response = await fetchMihomoApi(mihomoConfig, "/proxies", { fetchImpl });
  if (!response.ok) {
    throw await mihomoApiError(response, "Mihomo API failed");
  }
  const data = await response.json();
  const nodes = Object.entries(data.proxies || {})
    .filter(([, proxy]) => !Array.isArray(proxy.all))
    .map(([name, proxy]) => ({ name, type: proxy.type, alive: proxy.alive !== false }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { nodes };
}

async function fetchMihomoApi(mihomoConfig, path, { fetchImpl = fetch, timeout = 2500 } = {}) {
  try {
    return await fetchImpl(`${baseUrl(mihomoConfig)}${path}`, {
      headers: buildHeaders(mihomoConfig),
      signal: AbortSignal.timeout(timeout)
    });
  } catch (error) {
    const wrapped = new Error(`Mihomo API connection failed: ${error.message}`);
    wrapped.cause = error;
    throw wrapped;
  }
}

async function mihomoApiError(response, prefix) {
  const detail = typeof response.text === "function" ? (await response.text()).trim() : "";
  if (response.status === 401) {
    return new Error(`${prefix}: 401 Unauthorized. 请检查外部代理客户端的访问密钥。`);
  }
  return new Error(detail ? `${prefix}: ${response.status} ${detail}` : `${prefix}: ${response.status}`);
}

export async function testNodeDelay(mihomoConfig, nodeName, { fetchImpl = fetch, testUrl = "https://www.gstatic.com/generate_204", timeout = 5000 } = {}) {
  const params = new URLSearchParams({
    url: testUrl,
    timeout: String(timeout)
  });
  const response = await fetchImpl(`${baseUrl(mihomoConfig)}/proxies/${encodeURIComponent(nodeName)}/delay?${params}`, {
    headers: buildHeaders(mihomoConfig),
    signal: AbortSignal.timeout(timeout + 1000)
  });
  if (!response.ok) {
    const detail = typeof response.text === "function" ? (await response.text()).trim() : "";
    throw new Error(detail ? `Mihomo node delay failed: ${response.status} ${detail}` : `Mihomo node delay failed: ${response.status}`);
  }
  const data = await response.json();
  const delay = Number(data.delay);
  if (!Number.isFinite(delay)) {
    throw new Error("Mihomo node delay failed: invalid delay");
  }
  return { node: nodeName, delay };
}

export async function reloadConfig(mihomoConfig, { fetchImpl = fetch } = {}) {
  const response = await fetchImpl(`${baseUrl(mihomoConfig)}/configs?force=true`, {
    method: "PUT",
    headers: buildHeaders(mihomoConfig),
    body: "{}",
    signal: AbortSignal.timeout(2500)
  });
  if (!response.ok) {
    const detail = typeof response.text === "function" ? (await response.text()).trim() : "";
    throw new Error(detail ? `Mihomo reload failed: ${response.status} ${detail}` : `Mihomo reload failed: ${response.status}`);
  }
  return { reloaded: true };
}

export function updateListenerProxy(mergePath, port, nodeName, listenerName = `tk-${port}`) {
  const original = readFileSync(mergePath, "utf8");
  const lines = original.split("\n");
  let inTarget = false;
  let replaced = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\s*-\s+name:/.test(line)) {
      inTarget = false;
    }
    if (new RegExp(`^\\s*port:\\s*${port}\\s*$`).test(line)) {
      inTarget = true;
    }
    if (inTarget && /^\s*proxy:/.test(line)) {
      const indent = line.match(/^\s*/)[0];
      lines[index] = `${indent}proxy: ${quoteYamlString(nodeName)}`;
      replaced = true;
      break;
    }
  }

  if (!replaced) {
    insertListener(lines, listenerName, port, nodeName);
    writeFileSync(mergePath, lines.join("\n"));
    return { port, nodeName, changed: true, created: true };
  }
  writeFileSync(mergePath, lines.join("\n"));
  return { port, nodeName, changed: true, created: false };
}

export function updateListenerProxyEverywhere({ mergePath, runtimePath, port, nodeName, listenerName }) {
  const merge = updateListenerProxy(mergePath, port, nodeName, listenerName);
  const resolvedRuntimePath = runtimePath || inferRuntimeConfigPath(mergePath);
  const runtime = existsSync(resolvedRuntimePath)
    ? { ...updateListenerProxy(resolvedRuntimePath, port, nodeName, listenerName), skipped: false, path: resolvedRuntimePath }
    : {
        skipped: true,
        path: resolvedRuntimePath,
        reason: "runtime-config-not-found"
      };
  return { merge, runtime };
}

export function inferRuntimeConfigPath(mergePath) {
  return join(dirname(dirname(mergePath)), "clash-verge.yaml");
}

export function readListenerProxy(mergePath, port) {
  const lines = readFileSync(mergePath, "utf8").split("\n");
  let inTarget = false;

  for (const line of lines) {
    if (/^\s*-\s+name:/.test(line)) {
      inTarget = false;
    }
    if (new RegExp(`^\\s*port:\\s*${port}\\s*$`).test(line)) {
      inTarget = true;
    }
    if (inTarget && /^\s*proxy:/.test(line)) {
      return unquoteYamlString(line.replace(/^\s*proxy:\s*/, "").trim());
    }
  }
  return "";
}

export function listExternalProxyClientCandidates(config = {}, homeDir = homedir()) {
  const clashVergeRevRoot = join(homeDir, "Library/Application Support/io.github.clash-verge-rev.clash-verge-rev");
  const candidates = [
    {
      id: "clash-verge-rev",
      label: "Clash Verge Rev",
      description: "推荐，当前默认适配的外部 Mihomo 客户端。",
      controllerUrl: config.controllerUrl || "http://127.0.0.1:9097",
      secret: config.secret || "",
      mergePath: "~/Library/Application Support/io.github.clash-verge-rev.clash-verge-rev/profiles/Merge.yaml",
      runtimePath: "~/Library/Application Support/io.github.clash-verge-rev.clash-verge-rev/clash-verge.yaml",
      appPath: clashVergeRevRoot
    }
  ];

  return candidates.map((candidate) => {
    const mergePath = candidate.mergePath ? expandHomeLike(candidate.mergePath, homeDir) : "";
    const appInstalled = candidate.appPath ? existsSync(candidate.appPath) : false;
    const mergeExists = mergePath ? existsSync(mergePath) : false;
    return {
      ...candidate,
      installed: appInstalled || mergeExists,
      appInstalled,
      mergeExists,
      expandedMergePath: mergePath
    };
  });
}

export function deleteListenerByPort(mergePath, port) {
  const lines = readFileSync(mergePath, "utf8").split("\n");
  const portIndex = lines.findIndex((line) => new RegExp(`^\\s*port:\\s*${port}\\s*$`).test(line));
  if (portIndex === -1) {
    return { port, changed: false, removed: false };
  }

  let start = portIndex;
  while (start >= 0 && !/^\s*-\s+name:/.test(lines[start])) start -= 1;
  if (start < 0) {
    return { port, changed: false, removed: false };
  }

  let end = lines.length;
  for (let index = portIndex + 1; index < lines.length; index += 1) {
    if (/^\s*-\s+name:/.test(lines[index]) || isTopLevelYamlKey(lines[index])) {
      end = index;
      break;
    }
  }

  while (end < lines.length && lines[end] === "") end += 1;
  const deleteFrom = start > 0 && lines[start - 1] === "" ? start - 1 : start;
  lines.splice(deleteFrom, end - deleteFrom);
  writeFileSync(mergePath, lines.join("\n"));
  return { port, changed: true, removed: true };
}

function expandHomeLike(path, homeDir) {
  return String(path || "").startsWith("~/") ? join(homeDir, String(path).slice(2)) : String(path || "");
}

function baseUrl(mihomoConfig) {
  return mihomoConfig.controllerUrl.replace(/\/$/, "");
}

function quoteYamlString(value) {
  return `"${String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function unquoteYamlString(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function insertListener(lines, listenerName, port, nodeName) {
  let listenersIndex = lines.findIndex((line) => /^listeners:\s*$/.test(line));
  if (listenersIndex === -1) {
    if (lines.at(-1) !== "") lines.push("");
    lines.push("listeners:");
    listenersIndex = lines.length - 1;
  }

  const { itemIndent, fieldIndent } = detectListenerIndentation(lines, listenersIndex);
  let insertIndex = lines.length;
  for (let index = listenersIndex + 1; index < lines.length; index += 1) {
    if (isTopLevelYamlKey(lines[index])) {
      insertIndex = index;
      break;
    }
  }
  if (insertIndex > listenersIndex + 1 && lines[insertIndex - 1] === "") {
    insertIndex -= 1;
  }

  const block = [
    `${itemIndent}- name: ${quoteYamlString(listenerName)}`,
    `${fieldIndent}type: mixed`,
    `${fieldIndent}listen: 127.0.0.1`,
    `${fieldIndent}port: ${port}`,
    `${fieldIndent}proxy: ${quoteYamlString(nodeName)}`,
    `${fieldIndent}udp: true`
  ];
  if (insertIndex < lines.length) block.push("");
  lines.splice(insertIndex, 0, ...block);
}

function detectListenerIndentation(lines, listenersIndex) {
  for (let index = listenersIndex + 1; index < lines.length; index += 1) {
    const itemMatch = lines[index].match(/^(\s*)-\s+name:/);
    if (!itemMatch) continue;
    const itemIndent = itemMatch[1];
    const nextLine = lines[index + 1] || "";
    const fieldMatch = nextLine.match(/^(\s+)[A-Za-z0-9_-]+:/);
    return {
      itemIndent,
      fieldIndent: fieldMatch ? fieldMatch[1] : `${itemIndent}  `
    };
  }
  return {
    itemIndent: "  ",
    fieldIndent: "    "
  };
}

function isTopLevelYamlKey(line) {
  return /^[A-Za-z0-9_-]+:\s*(?:[^#].*)?$/.test(line);
}
