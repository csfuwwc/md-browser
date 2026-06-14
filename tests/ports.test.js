import assert from "node:assert/strict";
import test from "node:test";
import { parseLsofProcesses, terminateTcpPort } from "../src/ports.js";

test("parseLsofProcesses extracts listener process details", () => {
  assert.deepEqual(parseLsofProcesses("p1234\ncGoogle Chrome\nLliyanpeng\np5678\ncnode\nLroot\n"), [
    { pid: 1234, command: "Google Chrome", user: "liyanpeng" },
    { pid: 5678, command: "node", user: "root" }
  ]);
});

test("terminateTcpPort sends SIGTERM to port listener processes", async () => {
  const killed = [];
  let calls = 0;
  const result = await terminateTcpPort(9222, {
    inspectImpl: async () => {
      calls += 1;
      return {
        port: 9222,
        listening: calls === 1,
        processes: calls === 1
          ? [
              { pid: 1234, command: "Google Chrome", user: "liyanpeng" },
              { pid: process.pid, command: "node", user: "liyanpeng" }
            ]
          : []
      };
    },
    killImpl: (pid, signal) => killed.push([pid, signal]),
    waitMs: 0
  });

  assert.deepEqual(killed, [[1234, "SIGTERM"]]);
  assert.deepEqual(result.killed, [{ pid: 1234, command: "Google Chrome", user: "liyanpeng", signal: "SIGTERM" }]);
});

test("terminateTcpPort escalates to SIGKILL when the listener survives SIGTERM", async () => {
  const killed = [];
  const result = await terminateTcpPort(9222, {
    inspectImpl: async () => ({
      port: 9222,
      listening: true,
      processes: [{ pid: 1234, command: "Google Chrome", user: "liyanpeng" }]
    }),
    killImpl: (pid, signal) => killed.push([pid, signal]),
    waitMs: 0
  });

  assert.deepEqual(killed, [[1234, "SIGTERM"], [1234, "SIGKILL"]]);
  assert.deepEqual(result.killed, [
    { pid: 1234, command: "Google Chrome", user: "liyanpeng", signal: "SIGTERM" },
    { pid: 1234, command: "Google Chrome", user: "liyanpeng", signal: "SIGKILL" }
  ]);
});

test("terminateTcpPort leaves processes alone when they are not allowed", async () => {
  const killed = [];
  const result = await terminateTcpPort(9222, {
    inspectImpl: async () => ({
      port: 9222,
      listening: true,
      processes: [{ pid: 1234, command: "Google Chrome", user: "liyanpeng", fullCommand: "Google Chrome --remote-debugging-port=9222" }]
    }),
    killImpl: (pid, signal) => killed.push([pid, signal]),
    shouldTerminate: () => false,
    waitMs: 0
  });

  assert.deepEqual(killed, []);
  assert.deepEqual(result.killed, []);
});
