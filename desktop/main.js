const { app, BrowserWindow, ipcMain, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const HEALTH_CHECK_TIMEOUT_MS = 5000;
const DEFAULT_SERVER_URL = process.env.PROPPING_DESKTOP_URL || "https://app.proping.co.uk";

let mainWindow = null;
let launchInProgress = false;

function configFilePath() {
  return path.join(app.getPath("userData"), "propping-desktop-config.json");
}

function normalizeUrl(value) {
  if (!value || typeof value !== "string") {
    return null;
  }

  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function withLoginPath(baseUrl) {
  const url = new URL(baseUrl);
  url.pathname = "/login";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function buildCandidateBases(baseUrl) {
  const candidates = [];
  const seen = new Set();

  const push = (value) => {
    const normalized = normalizeUrl(value);
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    candidates.push(normalized);
  };

  push(baseUrl);

  try {
    const parsed = new URL(baseUrl);
    const host = parsed.hostname.toLowerCase();
    const isLocal = host === "localhost" || host === "127.0.0.1";
    if (!isLocal && !host.startsWith("app.")) {
      const suggested = new URL(parsed.toString());
      suggested.hostname = `app.${host}`;
      push(suggested.toString());
    }
  } catch {
    return candidates;
  }

  return candidates;
}

async function isPropPingServer(baseUrl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);
  try {
    const response = await fetch(new URL("/api/health", baseUrl).toString(), {
      method: "GET",
      headers: { accept: "application/json" },
      signal: controller.signal
    });
    const body = await response.json().catch(() => null);
    return Boolean(body && body.service === "PropPing" && (body.status === "ok" || body.status === "error"));
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function resolvePropPingBase(inputUrl) {
  const candidates = buildCandidateBases(inputUrl);
  for (const candidate of candidates) {
    if (await isPropPingServer(candidate)) {
      return candidate;
    }
  }
  return null;
}

function loadConfig() {
  const filePath = configFilePath();
  const fallback = {
    serverUrl: normalizeUrl(DEFAULT_SERVER_URL) || "https://app.proping.co.uk"
  };

  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(fallback, null, 2), "utf8");
    return fallback;
  }

  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return {
      serverUrl: normalizeUrl(parsed.serverUrl) || fallback.serverUrl
    };
  } catch {
    fs.writeFileSync(filePath, JSON.stringify(fallback, null, 2), "utf8");
    return fallback;
  }
}

function saveConfig(nextConfig) {
  fs.writeFileSync(configFilePath(), JSON.stringify(nextConfig, null, 2), "utf8");
}

async function showOffline(reason = "") {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  await mainWindow.loadFile(path.join(__dirname, "offline.html"), {
    query: {
      reason
    }
  });
}

async function launchRemote(config) {
  const resolvedBase = await resolvePropPingBase(config.serverUrl);
  if (!resolvedBase) {
    await showOffline("remote_unreachable");
    return { ok: false, reason: "remote_unreachable" };
  }

  if (resolvedBase !== config.serverUrl) {
    saveConfig({ serverUrl: resolvedBase });
  }

  await mainWindow.loadURL(withLoginPath(resolvedBase));
  return { ok: true };
}

async function launchFromConfig() {
  if (launchInProgress) {
    return;
  }
  launchInProgress = true;
  try {
    const config = loadConfig();
    await launchRemote(config);
  } catch {
    await showOffline("unexpected_error");
  } finally {
    launchInProgress = false;
  }
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1160,
    minHeight: 760,
    backgroundColor: "#e7eef8",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("did-fail-load", async () => {
    if (!mainWindow.isDestroyed()) {
      await showOffline("page_load_failed");
    }
  });

  launchFromConfig();
}

ipcMain.handle("desktop-config:get", async () => {
  return { ...loadConfig(), packaged: app.isPackaged };
});

ipcMain.handle("desktop-config:set", async (_event, payload) => {
  const nextUrl = normalizeUrl(payload?.serverUrl);
  if (!nextUrl) {
    return { ok: false, error: "invalid_url" };
  }

  const resolvedBase = await resolvePropPingBase(nextUrl);
  if (!resolvedBase) {
    return { ok: false, error: "not_propping_server" };
  }

  saveConfig({ serverUrl: resolvedBase });
  if (mainWindow && !mainWindow.isDestroyed()) {
    await mainWindow.loadURL(withLoginPath(resolvedBase));
  }
  return { ok: true };
});

ipcMain.handle("desktop-app:retry", async () => {
  await launchFromConfig();
  return { ok: true };
});

ipcMain.handle("desktop-config:open-folder", async () => {
  shell.openPath(app.getPath("userData"));
  return { ok: true };
});

app.whenReady().then(() => {
  createMainWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
