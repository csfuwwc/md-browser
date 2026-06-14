const { app, BrowserWindow, dialog, shell } = require("electron");
const { pathToFileURL } = require("node:url");
const { join } = require("node:path");

let mainWindow = null;
let webServer = null;

function serverUrlFromConfig(config) {
  const host = config.server?.host || "127.0.0.1";
  const port = config.server?.port || 18777;
  return `http://${host}:${port}`;
}

async function isExistingMdBrowserService(url) {
  try {
    const response = await fetch(`${url}/api/status`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(1200)
    });
    if (!response.ok) return false;
    const status = await response.json();
    return status?.app?.productName === "MD-Browser";
  } catch {
    return false;
  }
}

async function startLocalWebUI() {
  const serverModulePath = pathToFileURL(join(__dirname, "..", "src", "server.js")).href;
  const configModulePath = pathToFileURL(join(__dirname, "..", "src", "config.js")).href;
  const [{ startServer }, { loadConfig }] = await Promise.all([
    import(serverModulePath),
    import(configModulePath)
  ]);
  const config = loadConfig();
  const url = serverUrlFromConfig(config);

  try {
    const started = await startServer(config);
    webServer = started.server;
    return started.url;
  } catch (error) {
    if (error && error.code === "EADDRINUSE") {
      if (await isExistingMdBrowserService(url)) {
        return url;
      }
      throw new Error(`本地服务端口已被占用：${url}。请关闭占用该端口的程序，或在配置文件中更换 MD-Browser 服务端口后重新打开。`);
    }
    throw error;
  }
}

async function waitForWebUI(url) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Keep waiting while the local service finishes binding the port.
    }
    await new Promise((resolve) => setTimeout(resolve, 180));
  }
  throw new Error("本地页面服务启动超时。");
}

function createWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 1080,
    minHeight: 720,
    title: "MD-Browser",
    backgroundColor: "#f4f7fb",
    show: false,
    trafficLightPosition: { x: 18, y: 18 },
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    shell.openExternal(targetUrl);
    return { action: "deny" };
  });

  mainWindow.loadURL(url);
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    try {
      const url = await startLocalWebUI();
      await waitForWebUI(url);
      createWindow(url);
    } catch (error) {
      dialog.showErrorBox("MD-Browser 启动失败", error.message || String(error));
      app.quit();
    }
  });
}

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0 && mainWindow) {
    mainWindow.show();
  }
});

app.on("window-all-closed", () => {
  app.quit();
});

app.on("before-quit", () => {
  if (webServer) {
    webServer.close();
    webServer = null;
  }
});
