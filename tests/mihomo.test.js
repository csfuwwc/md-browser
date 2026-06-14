import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildHeaders,
  deleteListenerByPort,
  inferRuntimeConfigPath,
  listExternalProxyClientCandidates,
  listNodes,
  readListenerProxy,
  reloadConfig,
  testNodeDelay,
  updateListenerProxy,
  updateListenerProxyEverywhere
} from "../src/mihomo.js";

test("buildHeaders includes Authorization when secret exists", () => {
  assert.deepEqual(buildHeaders({ secret: "abc" }), {
    Authorization: "Bearer abc",
    "content-type": "application/json"
  });
});

test("listExternalProxyClientCandidates detects Clash Verge Rev merge path", () => {
  const home = mkdtempSync(join(tmpdir(), "tk-proxy-client-"));
  try {
    mkdirSync(join(home, "Library/Application Support/io.github.clash-verge-rev.clash-verge-rev/profiles"), { recursive: true });
    writeFileSync(join(home, "Library/Application Support/io.github.clash-verge-rev.clash-verge-rev/profiles/Merge.yaml"), "listeners: []\n");

    const candidates = listExternalProxyClientCandidates({ controllerUrl: "http://127.0.0.1:9097" }, home);
    const verge = candidates.find((candidate) => candidate.id === "clash-verge-rev");
    assert.ok(verge);
    assert.equal(candidates.some((candidate) => candidate.id === "custom-mihomo"), false);
    assert.equal(verge.installed, true);
    assert.equal(verge.mergeExists, true);
    assert.equal(verge.controllerUrl, "http://127.0.0.1:9097");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("reloadConfig sends Mihomo compatible PUT request", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 204, json: async () => ({}) };
  };

  const result = await reloadConfig(
    { controllerUrl: "http://127.0.0.1:9090", secret: "" },
    { fetchImpl }
  );

  assert.equal(result.reloaded, true);
  assert.equal(calls[0].url, "http://127.0.0.1:9090/configs?force=true");
  assert.equal(calls[0].options.method, "PUT");
  assert.equal(calls[0].options.body, "{}");
});

test("reloadConfig includes Mihomo response body in thrown error", async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 400,
    text: async () => "yaml: line 92: did not find expected '-' indicator"
  });

  await assert.rejects(
    reloadConfig(
      { controllerUrl: "http://127.0.0.1:9090", secret: "" },
      { fetchImpl }
    ),
    /yaml: line 92: did not find expected '-' indicator/
  );
});

test("listNodes explains Mihomo unauthorized responses", async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 401,
    text: async () => "{\"message\":\"Unauthorized\"}"
  });

  await assert.rejects(
    listNodes(
      { controllerUrl: "http://127.0.0.1:9090", secret: "wrong" },
      { fetchImpl }
    ),
    /访问密钥/
  );
});

test("testNodeDelay calls Mihomo delay endpoint for encoded node name", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 200, json: async () => ({ delay: 238 }) };
  };

  const result = await testNodeDelay(
    { controllerUrl: "http://127.0.0.1:9090", secret: "abc" },
    "[Anytls]台湾001",
    { fetchImpl, timeout: 3000 }
  );

  assert.equal(result.node, "[Anytls]台湾001");
  assert.equal(result.delay, 238);
  assert.match(calls[0].url, /\/proxies\/%5BAnytls%5D%E5%8F%B0%E6%B9%BE001\/delay\?/);
  assert.match(calls[0].url, /timeout=3000/);
  assert.equal(calls[0].options.headers.Authorization, "Bearer abc");
});

test("updateListenerProxy updates proxy for matching listener port", () => {
  const dir = mkdtempSync(join(tmpdir(), "tk-merge-"));
  const file = join(dir, "Merge.yaml");
  try {
    writeFileSync(file, [
      "listeners:",
      "  - name: tk-us",
      "    type: mixed",
      "    port: 18101",
      "    proxy: old-us",
      "  - name: tk-th",
      "    type: mixed",
      "    port: 18103",
      "    proxy: old-th",
      ""
    ].join("\n"));

    updateListenerProxy(file, 18103, "[Anytls][偏远]泰国");
    const updated = readFileSync(file, "utf8");
    assert.match(updated, /port: 18101\n    proxy: old-us/);
    assert.match(updated, /port: 18103\n    proxy: "\[Anytls\]\[偏远\]泰国"/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("updateListenerProxy creates listener when port is missing", () => {
  const dir = mkdtempSync(join(tmpdir(), "tk-merge-"));
  const file = join(dir, "Merge.yaml");
  try {
    writeFileSync(file, [
      "listeners:",
      "  - name: tk-us",
      "    type: mixed",
      "    listen: 127.0.0.1",
      "    port: 18101",
      "    proxy: old-us",
      "    udp: true",
      "",
      "tun:",
      "  bypass:",
      "    - localhost",
      ""
    ].join("\n"));

    const result = updateListenerProxy(file, 18102, "[Anytls]美国BGP001", "tk-br");
    const updated = readFileSync(file, "utf8");
    assert.equal(result.created, true);
    assert.match(updated, /name: "tk-br"\n    type: mixed\n    listen: 127\.0\.0\.1\n    port: 18102\n    proxy: "\[Anytls\]美国BGP001"/);
    assert.match(updated, /\n\ntun:\n  bypass:/);
    assert.equal(readListenerProxy(file, 18102), "[Anytls]美国BGP001");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("deleteListenerByPort removes matching listener block", () => {
  const dir = mkdtempSync(join(tmpdir(), "tk-merge-"));
  const file = join(dir, "Merge.yaml");
  try {
    writeFileSync(file, [
      "listeners:",
      "  - name: shopee-us",
      "    type: mixed",
      "    listen: 127.0.0.1",
      "    port: 18101",
      "    proxy: old-us",
      "    udp: true",
      "",
      "  - name: TikTok UK",
      "    type: mixed",
      "    listen: 127.0.0.1",
      "    port: 18104",
      "    proxy: old-uk",
      "    udp: true",
      "",
      "tun:",
      "  bypass:",
      "    - localhost",
      ""
    ].join("\n"));

    const result = deleteListenerByPort(file, 18104);
    const updated = readFileSync(file, "utf8");

    assert.equal(result.changed, true);
    assert.equal(result.removed, true);
    assert.match(updated, /name: shopee-us/);
    assert.doesNotMatch(updated, /name: TikTok UK/);
    assert.match(updated, /\ntun:\n  bypass:/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("inferRuntimeConfigPath resolves Clash Verge generated config beside profiles directory", () => {
  assert.equal(
    inferRuntimeConfigPath("/Users/me/Library/Application Support/io.github.clash-verge-rev.clash-verge-rev/profiles/Merge.yaml"),
    "/Users/me/Library/Application Support/io.github.clash-verge-rev.clash-verge-rev/clash-verge.yaml"
  );
});

test("updateListenerProxyEverywhere updates only merge config", () => {
  const dir = mkdtempSync(join(tmpdir(), "tk-merge-"));
  const profilesDir = join(dir, "profiles");
  const mergeFile = join(profilesDir, "Merge.yaml");
  const runtimeFile = join(dir, "clash-verge.yaml");
  try {
    mkdirSync(profilesDir);
    writeFileSync(mergeFile, [
      "listeners:",
      "  - name: tk-us",
      "    type: mixed",
      "    listen: 127.0.0.1",
      "    port: 18101",
      "    proxy: old-us",
      "    udp: true",
      "",
      "tun:",
      "  bypass:",
      "    - localhost",
      ""
    ].join("\n"));
    writeFileSync(runtimeFile, [
      "# Generated by Clash Verge",
      "",
      "mode: rule",
      "listeners:",
      "- name: tk-us",
      "  type: mixed",
      "  listen: 127.0.0.1",
      "  port: 18101",
      "  proxy: old-us",
      "  udp: true",
      "keep-alive-interval: 360",
      ""
    ].join("\n"));

    const result = updateListenerProxyEverywhere({
      mergePath: mergeFile,
      port: 18104,
      nodeName: "[Anytls][偏远]英国",
      listenerName: "TikTok UK"
    });

    assert.equal(result.merge.created, true);
    assert.equal(result.runtime.skipped, false);
    assert.equal(result.runtime.created, true);
    assert.equal(readListenerProxy(mergeFile, 18104), "[Anytls][偏远]英国");
    assert.match(readFileSync(mergeFile, "utf8"), /name: "TikTok UK"/);
    assert.equal(readListenerProxy(runtimeFile, 18104), "[Anytls][偏远]英国");
    assert.match(readFileSync(runtimeFile, "utf8"), /name: "TikTok UK"/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readListenerProxy reads proxy for matching listener port", () => {
  const dir = mkdtempSync(join(tmpdir(), "tk-merge-"));
  const file = join(dir, "Merge.yaml");
  try {
    writeFileSync(file, [
      "listeners:",
      "  - name: tk-us",
      "    type: mixed",
      "    port: 18101",
      "    proxy: \"[HY2]美国BGP002TEST\"",
      ""
    ].join("\n"));

    assert.equal(readListenerProxy(file, 18101), "[HY2]美国BGP002TEST");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
