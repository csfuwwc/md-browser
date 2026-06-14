#!/usr/bin/env node

import { handleMcpMessage, mcpToolText } from "../src/mcp.js";

const BASE_URL = process.env.MD_BROWSER_URL || "http://127.0.0.1:18777";

let buffer = Buffer.alloc(0);

process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  drainMessages().catch((error) => {
    sendError(null, -32603, error.message);
  });
});

async function drainMessages() {
  while (true) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) return;
    const header = buffer.slice(0, headerEnd).toString("utf8");
    const match = header.match(/content-length:\s*(\d+)/i);
    if (!match) {
      buffer = buffer.slice(headerEnd + 4);
      continue;
    }
    const length = Number(match[1]);
    const messageStart = headerEnd + 4;
    const messageEnd = messageStart + length;
    if (buffer.length < messageEnd) return;
    const raw = buffer.slice(messageStart, messageEnd).toString("utf8");
    buffer = buffer.slice(messageEnd);
    await handleMessage(JSON.parse(raw));
  }
}

async function handleMessage(message) {
  const response = await handleMcpMessage(message, {
    callTool,
    serverInfo: { name: "md-browser", version: "0.1.0" }
  });
  if (response) send(response);
}

async function callTool(name, args) {
  if (name === "list_browser_configs") {
    return mcpToolText(await apiJson("/api/agent/routes"));
  }
  if (name === "get_browser_config") {
    return mcpToolText(await apiJson(`/api/agent/routes/${encodeURIComponent(args.key)}`));
  }
  if (name === "launch_browser_config") {
    return mcpToolText(await apiJson(`/api/agent/routes/${encodeURIComponent(args.key)}/launch`, { method: "POST" }));
  }
  if (name === "open_url_in_config") {
    return mcpToolText(await apiJson(`/api/agent/routes/${encodeURIComponent(args.key)}/open-url`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: args.url })
    }));
  }
  if (name === "test_config_node_delay") {
    return mcpToolText(await apiJson(`/api/agent/routes/${encodeURIComponent(args.key)}/node-delay`, { method: "POST" }));
  }
  throw new Error(`Unknown tool: ${name}`);
}

async function apiJson(path, options) {
  let response;
  try {
    response = await fetch(`${BASE_URL}${path}`, { ...options, signal: AbortSignal.timeout(12000) });
  } catch (error) {
    throw new Error(`MD-Browser 服务未连接：${error.message}`);
  }
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(data.error || text || `MD-Browser API failed: ${response.status}`);
  }
  return data;
}

function sendError(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

function send(payload) {
  const body = JSON.stringify(payload);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`);
}
