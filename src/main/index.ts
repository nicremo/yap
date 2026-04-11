import { app, BrowserWindow } from 'electron';

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
import { createMainWindow, createOverlayWindow, positionOverlayWindow } from './windows';
import type { AppSettings, AppStatus } from '../shared/types';

let mainWindow: BrowserWindow | null = null;
let overlayWindow: BrowserWindow | null = null;
let settings: AppSettings;
let status: AppStatus = getInitialStatus();
let helperReady = false;
let isQuitting = false;
let hideOverlayTimeout: NodeJS.Timeout | null = null;

function shutdown(): void {
  if (isQuitting) {
    return;
  }

  isQuitting = true;
  stopFnListener();
}

function broadcast(channel: string, payload: unknown): void {
  for (const window of [mainWindow, overlayWindow]) {
    if (window && !window.isDestroyed()) {
      window.webContents.send(channel, payload);
    }
  }
}

async function ensureOverlayWindow(): Promise<BrowserWindow | null> {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    return overlayWindow;
  }

  overlayWindow = await createOverlayWindow();
  attachWindowDiagnostics(overlayWindow, 'overlay');
  return overlayWindow;
}

async function showOverlay(): Promise<void> {
  const window = await ensureOverlayWindow();
  if (!window || window.isDestroyed()) {
    return;
  }

  positionOverlayWindow(window);
  window.showInactive();
}

function hideOverlaySoon(): void {
  if (hideOverlayTimeout) {
    clearTimeout(hideOverlayTimeout);
  }

  hideOverlayTimeout = setTimeout(() => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.hide();
    }
  }, 1_100);
}

function setStatus(nextStatus: AppStatus): void {
  status = nextStatus;
  broadcast('app:status', nextStatus);

  if (nextStatus.phase === 'idle') {
    hideOverlaySoon();
    return;
  }

  if (hideOverlayTimeout) {
    clearTimeout(hideOverlayTimeout);
    hideOverlayTimeout = null;
  }

  void showOverlay();
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

function attachWindowDiagnostics(window: BrowserWindow, label: string): void {
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
        title: 'Fn key unavailable',
        detail: message,
      });
    },
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

async function bootstrap(): Promise<void> {
  settings = await loadSettings();
  await ensureStorage(settings);
  applyLaunchAtLogin(settings.launchAtLogin);

  registerIpcHandlers({
    getSettings: () => settings,
    setSettings: (nextSettings) => {
      settings = nextSettings;
    },
    getStatus: () => status,
    setStatus,
    getHelperReady: () => helperReady,
    showMainWindow,
    hideMainWindow,
    ensureHotkeyListener,
  });

  await createWindows();
  await ensureOverlayWindow();

  helperReady = await ensureNativeHelper();

  await ensureHotkeyListener();
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
