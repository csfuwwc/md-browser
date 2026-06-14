export const MCP_PROTOCOL_VERSION = "2024-11-05";

export function mdBrowserMcpTools() {
  return [
    {
      name: "list_browser_configs",
      description: "List MD-Browser browser configs with CDP endpoint, proxy, node, profile, and readiness status.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    {
      name: "get_browser_config",
      description: "Get one MD-Browser browser config by key.",
      inputSchema: {
        type: "object",
        properties: { key: { type: "string", description: "Browser config key." } },
        required: ["key"],
        additionalProperties: false
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    {
      name: "launch_browser_config",
      description: "Launch or connect a configured MD-Browser browser environment.",
      inputSchema: {
        type: "object",
        properties: { key: { type: "string", description: "Browser config key." } },
        required: ["key"],
        additionalProperties: false
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    {
      name: "open_url_in_config",
      description: "Launch or connect a browser config and open a URL in that environment.",
      inputSchema: {
        type: "object",
        properties: {
          key: { type: "string", description: "Browser config key." },
          url: { type: "string", description: "URL or domain to open. Domains are normalized to https://." }
        },
        required: ["key", "url"],
        additionalProperties: false
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    },
    {
      name: "test_config_node_delay",
      description: "Test the delay of the node currently bound to a browser config.",
      inputSchema: {
        type: "object",
        properties: { key: { type: "string", description: "Browser config key." } },
        required: ["key"],
        additionalProperties: false
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    }
  ];
}

export async function handleMcpMessage(message, { callTool, serverInfo = {} } = {}) {
  if (!message || message.jsonrpc !== "2.0") {
    return mcpError(message?.id ?? null, -32600, "Invalid JSON-RPC request.");
  }
  if (message.id === undefined || message.id === null) return null;

  try {
    if (message.method === "initialize") {
      return mcpResult(message.id, {
        protocolVersion: message.params?.protocolVersion || MCP_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: {
          name: serverInfo.name || "md-browser",
          version: serverInfo.version || "0.1.0"
        }
      });
    }
    if (message.method === "ping") {
      return mcpResult(message.id, {});
    }
    if (message.method === "tools/list") {
      return mcpResult(message.id, { tools: mdBrowserMcpTools() });
    }
    if (message.method === "tools/call") {
      if (!callTool) throw new Error("MCP tool caller is not configured.");
      return mcpResult(message.id, await callTool(message.params?.name, message.params?.arguments || {}));
    }
    return mcpError(message.id, -32601, `Unknown method: ${message.method}`);
  } catch (error) {
    return mcpError(message.id, -32603, error.message || "MCP tool call failed.");
  }
}

export function mcpToolText(value) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(value, null, 2)
      }
    ]
  };
}

function mcpResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function mcpError(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}
