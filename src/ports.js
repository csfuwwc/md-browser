import { createConnection } from "node:net";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function isTcpListening(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port, timeout: 800 });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(false));
  });
}

export async function fetchCdpVersion(cdpPort) {
  const urls = [
    `http://127.0.0.1:${cdpPort}/json/version`,
    `http://[::1]:${cdpPort}/json/version`
  ];
  for (const url of urls) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (response.ok) return await response.json();
    } catch {
      continue;
    }
  }
  return null;
}

export function parseProxyPort(proxyUrl) {
  const parsed = new URL(proxyUrl);
  return Number(parsed.port);
}

export function parseLsofProcesses(output) {
  const processes = [];
  let current = null;
  for (const line of String(output || "").split(/\r?\n/)) {
    if (!line) continue;
    const type = line[0];
    const value = line.slice(1);
    if (type === "p") {
      current = { pid: Number(value), command: "", user: "" };
      if (Number.isInteger(current.pid)) processes.push(current);
      continue;
    }
    if (!current) continue;
    if (type === "c") current.command = value;
    if (type === "L") current.user = value;
  }
  return processes;
}

export async function inspectTcpPort(port, { execFileImpl = execFileAsync } = {}) {
  const normalizedPort = Number(port);
  if (!Number.isInteger(normalizedPort) || normalizedPort < 1) {
    throw new Error(`Invalid TCP port: ${port}`);
  }
  try {
    const { stdout } = await execFileImpl("lsof", ["-nP", `-iTCP:${normalizedPort}`, "-sTCP:LISTEN", "-F", "pcL"], {
      timeout: 2500,
      maxBuffer: 1024 * 256
    });
    const processes = await attachProcessCommands(parseLsofProcesses(stdout), execFileImpl);
    return {
      port: normalizedPort,
      listening: true,
      processes
    };
  } catch {
    return {
      port: normalizedPort,
      listening: false,
      processes: []
    };
  }
}

async function attachProcessCommands(processes, execFileImpl) {
  return Promise.all(processes.map(async (processInfo) => {
    try {
      const { stdout } = await execFileImpl("ps", ["-p", String(processInfo.pid), "-o", "command="], {
        timeout: 1500,
        maxBuffer: 1024 * 128
      });
      return { ...processInfo, fullCommand: String(stdout || "").trim() };
    } catch {
      return processInfo;
    }
  }));
}

export async function terminateTcpPort(port, {
  inspectImpl = inspectTcpPort,
  killImpl = process.kill,
  shouldTerminate = () => true,
  waitMs = 700
} = {}) {
  const info = await inspectImpl(port);
  const killed = [];
  for (const processInfo of info.processes || []) {
    if (!Number.isInteger(processInfo.pid) || processInfo.pid <= 0 || processInfo.pid === process.pid) continue;
    if (!shouldTerminate(processInfo)) continue;
    killImpl(processInfo.pid, "SIGTERM");
    killed.push({ ...processInfo, signal: "SIGTERM" });
  }

  if (killed.length) await delay(waitMs);

  const afterTerm = await inspectImpl(port);
  for (const processInfo of afterTerm.processes || []) {
    if (!Number.isInteger(processInfo.pid) || processInfo.pid <= 0 || processInfo.pid === process.pid) continue;
    if (!shouldTerminate(processInfo)) continue;
    if (killed.some((item) => item.pid === processInfo.pid && item.signal === "SIGKILL")) continue;
    killImpl(processInfo.pid, "SIGKILL");
    killed.push({ ...processInfo, signal: "SIGKILL" });
  }
  return {
    port: Number(port),
    killed
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
