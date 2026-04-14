import { app, BrowserWindow, Menu, Tray, nativeImage } from 'electron';
import log from 'electron-log/main.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Persist logs to `{userData}/logs/main.log` (Windows: %APPDATA%\OpenWhisp\logs\main.log).
// Enable IPC bridge so renderer-side electron-log imports share the same sink,
// and route every existing `console.*` call through the file transport.
log.initialize();
log.transports.file.level = 'info';
log.transports.file.maxSize = 5 * 1024 * 1024;
log.transports.console.level = 'info';
Object.assign(console, log.functions);

import { getInitialStatus } from './dictation';
import { registerIpcHandlers } from './ipc';
import { applyLaunchAtLogin } from './login-item';
import {
  ensureNativeHelper,
  isFnListenerRunning,
  startFnListener,
  stopFnListener,
} from './native-helper';
import { getPermissionState } from './permissions';
import { loadSettings } from './settings';
import { ensureStorage } from './storage';
import { disposeAutoUpdater, initializeAutoUpdater } from './updater';
import { createMainWindow, createOverlayWindow, positionOverlayWindow } from './windows';
import type { AppSettings, AppStatus } from '../shared/types';

const projectRoot = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));

let mainWindow: BrowserWindow | null = null;
let overlayWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let settings: AppSettings;
let status: AppStatus = getInitialStatus();
let helperReady = false;
let isQuitting = false;

function shutdown(): void {
  if (isQuitting) {
    return;
  }

  isQuitting = true;
  disposeAutoUpdater();
  stopFnListener();
}

function broadcast(channel: string, payload: unknown): void {
  for (const window of [mainWindow, overlayWindow]) {
    if (window && !window.isDestroyed()) {
      window.webContents.send(channel, payload);
    }
  }
}

function isBrowserWindowAlive(window: BrowserWindow): boolean {
  return (
    !window.isDestroyed() &&
    !window.webContents.isDestroyed() &&
    !window.webContents.isCrashed()
  );
}

async function ensureOverlayWindow(): Promise<BrowserWindow | null> {
  const existing = overlayWindow;
  if (existing && isBrowserWindowAlive(existing)) {
    return existing;
  }

  // Previous instance is gone or its renderer crashed: drop the stale
  // reference so a fresh window is created instead of reusing a dead one.
  if (existing && !existing.isDestroyed()) {
    try {
      existing.destroy();
    } catch (error) {
      console.warn('[openwhisp] Failed to destroy stale overlay window:', error);
    }
  }
  overlayWindow = null;

  overlayWindow = await createOverlayWindow();
  attachWindowDiagnostics(overlayWindow, 'overlay', () => {
    overlayWindow = null;
  });
  return overlayWindow;
}

async function showOverlay(): Promise<void> {
  if (!settings?.showOverlay) {
    return;
  }

  const window = await ensureOverlayWindow();
  if (!window || !isBrowserWindowAlive(window)) {
    return;
  }

  positionOverlayWindow(window);
  window.showInactive();
}

function hideOverlay(): void {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.hide();
  }
}

function setStatus(nextStatus: AppStatus): void {
  status = nextStatus;
  broadcast('app:status', nextStatus);

  if (nextStatus.phase === 'error' || !settings?.showOverlay) {
    hideOverlay();
  } else {
    void showOverlay();
  }
}

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.show();
  mainWindow.focus();
}

function hideMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.hide();
}

function attachWindowDiagnostics(
  window: BrowserWindow,
  label: string,
  onGone?: () => void,
): void {
  window.webContents.on('did-finish-load', () => {
    console.log(`[openwhisp] ${label} did-finish-load`);
  });

  window.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, validatedURL) => {
      console.error(
        `[openwhisp] ${label} did-fail-load`,
        JSON.stringify({ errorCode, errorDescription, validatedURL }),
      );
    },
  );

  window.webContents.on('render-process-gone', (_event, details) => {
    console.error(`[openwhisp] ${label} render-process-gone`, JSON.stringify(details));
    // Clear the stale reference so the next showOverlay() rebuilds the window.
    onGone?.();
  });

  window.on('closed', () => {
    onGone?.();
  });

  window.on('unresponsive', () => {
    console.error(`[openwhisp] ${label} unresponsive`);
  });
}

async function ensureHotkeyListener(): Promise<void> {
  if (!helperReady || isFnListenerRunning()) {
    return;
  }

  const permissions = await getPermissionState();
  if (
    !permissions.accessibility ||
    !permissions.inputMonitoring ||
    !permissions.postEvents
  ) {
    return;
  }

  await startFnListener(
    (event) => {
      broadcast('hotkey:event', event);

      if (event.type === 'down') {
        void showOverlay();
      }
    },
    (message) => {
      setStatus({
        phase: 'error',
        title: 'Hotkey unavailable',
        detail: message,
      });
    },
    settings.hotkey,
  );
}

async function createWindows(): Promise<void> {
  mainWindow = await createMainWindow();
  attachWindowDiagnostics(mainWindow, 'main');

  mainWindow.on('ready-to-show', () => {
    showMainWindow();
  });

  mainWindow.on('close', (event) => {
    if (isQuitting) {
      return;
    }

    if (!app.isPackaged) {
      shutdown();
      return;
    }

    event.preventDefault();
    mainWindow?.hide();
  });

  showMainWindow();
}

async function restartHotkeyListener(): Promise<void> {
  stopFnListener();
  await ensureHotkeyListener();
}

async function bootstrap(): Promise<void> {
  console.log('[openwhisp] boot', {
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    electron: process.versions.electron,
    logPath: log.transports.file.getFile().path,
  });

  settings = await loadSettings();
  await ensureStorage(settings);
  applyLaunchAtLogin(settings.launchAtLogin);

  registerIpcHandlers({
    getSettings: () => settings,
    setSettings: (nextSettings) => {
      const overlayWasEnabled = settings?.showOverlay ?? true;
      settings = nextSettings;

      if (!nextSettings.showOverlay) {
        hideOverlay();
      } else if (!overlayWasEnabled) {
        void showOverlay();
      }
    },
    getStatus: () => status,
    setStatus,
    getHelperReady: () => helperReady,
    showMainWindow,
    hideMainWindow,
    ensureHotkeyListener,
    restartHotkeyListener,
    broadcast,
  });

  await createWindows();
  await ensureOverlayWindow();
  if (settings.showOverlay) void showOverlay();
  createTray();

  helperReady = await ensureNativeHelper();

  await ensureHotkeyListener();

  initializeAutoUpdater();
}

function getTrayIconPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'icons', 'trayTemplate.png');
  }
  return path.join(projectRoot, 'build', 'icons', 'trayTemplate.png');
}

function createTray(): void {
  const icon = nativeImage.createFromPath(getTrayIconPath());
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip('Openwhisp');

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show Openwhisp', click: () => showMainWindow() },
    { type: 'separator' },
    { label: 'Quit', click: () => { isQuitting = true; app.quit(); } },
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('click', () => showMainWindow());
}

app.whenReady().then(bootstrap);

app.on('web-contents-created', (_event, contents) => {
  contents.on('console-message', (_consoleEvent, level, message) => {
    console.log(`[openwhisp:renderer:${level}] ${message}`);
  });
});

app.on('activate', () => {
  showMainWindow();
});

app.on('will-quit', () => {
  shutdown();
});

app.on('before-quit', () => {
  shutdown();
});

process.on('SIGINT', () => {
  shutdown();
  app.quit();
});

process.on('SIGTERM', () => {
  shutdown();
  app.quit();
});

process.on('exit', () => {
  stopFnListener();
});
