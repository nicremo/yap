import { app, BrowserWindow, Menu, Notification, Tray, nativeImage, shell } from 'electron';
import log from 'electron-log/main.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Persist logs to {userData}/logs/main.log and route every console call there.
log.initialize();
log.transports.file.level = 'info';
log.transports.file.maxSize = 5 * 1024 * 1024;
log.transports.console.level = 'info';
Object.assign(console, log.functions);

import type { AppSettings, AppState, AppStatus, PermissionsState, PublicSettings, UpdateSettingsInput } from '../shared/types';
import { loadAppRules } from './app-rules';
import { sweepAudioStore } from './audio-store';
import { DictationEngine } from './dictation/engine';
import { loadCorrections, loadDictionary } from './dictionary';
import { validateGroqKey } from './groq';
import {
  loadGroqModelList,
  offeredRewriteModelIds,
  onGroqModelsChange,
  refreshGroqModelList,
  storeGroqModelList,
} from './groq-models';
import { clearAudioReferences, flushHistory, loadHistory } from './history';
import { registerIpcHandlers } from './ipc';
import { flushJsonWrites } from './json-file';
import { migrateLegacyUserData } from './legacy-migration';
import { LocalModelManager } from './local-model';
import { applyLaunchAtLogin } from './login-item';
import { createNativeBridge } from './native';
import { KEYBOARD_SETTINGS_URL, PermissionsService, toFnKeyAction } from './permissions';
import { getGroqApiKey, isGroqKeySet } from './secrets';
import { applySettingsUpdate, chooseStorageDirectory, loadSettings, saveSettings, withGroqKey } from './settings';
import { ensureStorage } from './storage';
import { disposeAutoUpdater, initializeAutoUpdater } from './updater';
import { createMainWindow, createOverlayWindow, positionOverlayWindow } from './windows';

const projectRoot = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const AUDIO_CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** The model list itself is only fetched when it is older than a day. */
const MODEL_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** How long after a permission click in Yap a grant brings the window back. */
const GRANT_WATCH_MS = 10 * 60 * 1000;

let settings: AppSettings;
let mainWindow: BrowserWindow | null = null;
let overlayWindow: BrowserWindow | null = null;
let overlayPromise: Promise<BrowserWindow | null> | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let status: AppStatus = { phase: 'idle', title: 'Ready', detail: '' };
let fnKeyAction: AppState['fnKeyAction'] = null;
let micPollTimer: ReturnType<typeof setInterval> | null = null;
let audioCleanupTimer: ReturnType<typeof setInterval> | null = null;
let modelCheckTimer: ReturnType<typeof setInterval> | null = null;

const bridge = createNativeBridge();
const permissions = new PermissionsService(bridge, {
  appHasFocus: () => BrowserWindow.getFocusedWindow() !== null,
});
const localModel = new LocalModelManager(
  () => settings,
  () => patch({ engine: engineState() }),
);

/* ── State broadcasting ─────────────────────────────────────────────────── */

function publicSettings(source: AppSettings): PublicSettings {
  const { groqApiKeyEncrypted: _omitted, ...rest } = source;
  return rest;
}

function engineState(): AppState['engine'] {
  return {
    groqKeySet: settings ? isGroqKeySet(settings) : false,
    localModelReady: localModel.isReady,
    localModelDownload: localModel.currentDownload,
    rewriteModelIds: offeredRewriteModelIds(),
  };
}

async function getState(): Promise<AppState> {
  const [dictionary, corrections, appRules, history] = await Promise.all([
    loadDictionary(),
    loadCorrections(),
    loadAppRules(),
    loadHistory(),
  ]);
  return {
    platform: process.platform,
    version: app.getVersion(),
    isPackaged: app.isPackaged,
    settings: publicSettings(settings),
    permissions: permissions.get(),
    engine: engineState(),
    dictionary,
    corrections,
    appRules,
    history,
    status,
    fnKeyAction,
  };
}

function sendToMain(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function patch(partial: Partial<AppState>): void {
  sendToMain('state:patch', partial);
}

/* ── Windows ────────────────────────────────────────────────────────────── */

function liveWindow(window: BrowserWindow | null): BrowserWindow | null {
  return window && !window.isDestroyed() && !window.webContents.isDestroyed() && !window.webContents.isCrashed()
    ? window
    : null;
}

function ensureOverlayWindow(): Promise<BrowserWindow | null> {
  const alive = liveWindow(overlayWindow);
  if (alive) return Promise.resolve(alive);
  if (overlayPromise) return overlayPromise;

  // The previous renderer crashed: drop it so a fresh one gets built.
  const stale = overlayWindow;
  if (stale && !stale.isDestroyed()) {
    stale.destroy();
  }
  overlayWindow = null;

  overlayPromise = createOverlayWindow()
    .then((window) => {
      overlayWindow = window;
      window.webContents.on('render-process-gone', (_event, details) => {
        console.error('[yap] overlay renderer gone', JSON.stringify(details));
        if (overlayWindow === window) overlayWindow = null;
        // Rebuild right away so the next dictation does not pay for it.
        if (!isQuitting) setTimeout(() => void ensureOverlayWindow(), 500);
      });
      window.on('closed', () => {
        if (overlayWindow === window) overlayWindow = null;
      });
      syncOverlay(true);
      return window;
    })
    .catch((error) => {
      console.error('[yap] overlay window could not be created:', error);
      return null;
    })
    .finally(() => {
      overlayPromise = null;
    });

  return overlayPromise;
}

function overlayShouldShow(): boolean {
  if (!settings?.showOverlay) return false;
  return settings.setupComplete || status.phase !== 'idle';
}

function syncOverlay(reposition = false): void {
  const window = liveWindow(overlayWindow);
  if (!window) return;

  if (!overlayShouldShow()) {
    if (window.isVisible()) window.hide();
    return;
  }
  if (reposition || !window.isVisible()) {
    positionOverlayWindow(window);
  }
  if (!window.isVisible()) {
    window.showInactive();
  }
}

function setStatus(next: AppStatus): void {
  const wasIdle = status.phase === 'idle' || status.phase === 'done' || status.phase === 'error';
  status = next;
  for (const window of [liveWindow(mainWindow), liveWindow(overlayWindow)]) {
    window?.webContents.send('app:status', next);
  }
  // Follow the cursor to the active display when a dictation starts.
  syncOverlay(wasIdle && next.phase === 'listening');
}

/*
 * Yap lives in the menu bar. The Dock icon, Cmd+Tab and the app menu exist
 * only while the window is open. setActivationPolicy sets NSApp's policy
 * directly; app.dock.hide()/show() would go through the asynchronous
 * TransformProcessType, which briefly hides windows and can leave a
 * duplicate Dock icon when switched quickly.
 */
function setDockVisible(visible: boolean): void {
  if (process.platform !== 'darwin') return;
  app.setActivationPolicy(visible ? 'regular' : 'accessory');
}

function showMainWindow(): void {
  const window = liveWindow(mainWindow);
  if (!window) return;
  setDockVisible(true);
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
  if (process.platform === 'darwin') app.focus({ steal: true });
}

function hideMainWindow(window: BrowserWindow): void {
  window.hide();
  setDockVisible(false);
}

/* Runs in the main window when a dictation ends while Yap itself is in front.
   Only a real text field takes the text; anything else would swallow Cmd+V. */
const EDITABLE_PROBE = `(() => {
  const element = document.activeElement;
  if (!element) return false;
  if (element.isContentEditable) return true;
  if (element instanceof HTMLTextAreaElement) return !element.readOnly && !element.disabled;
  if (element instanceof HTMLInputElement) {
    const textual = ['text', 'search', 'email', 'url', 'tel', 'password', 'number'];
    return textual.includes(element.type) && !element.readOnly && !element.disabled;
  }
  return false;
})()`;

async function ownTextFieldFocused(): Promise<boolean | null> {
  const window = liveWindow(mainWindow);
  // The overlay never takes focus, so a focused Yap window is the main window.
  if (!window || BrowserWindow.getFocusedWindow() !== window) return null;
  try {
    return (await window.webContents.executeJavaScript(EDITABLE_PROBE)) === true;
  } catch {
    return false;
  }
}

let lastNotification: { notification: Notification; title: string; at: number } | null = null;

function notify(title: string, body: string): void {
  if (!Notification.isSupported()) return;
  // Pressing the hotkey again for the same problem should not stack banners.
  if (lastNotification && lastNotification.title === title && Date.now() - lastNotification.at < 10_000) return;
  const notification = new Notification({ title, body, silent: true });
  notification.on('click', () => showMainWindow());
  notification.show();
  // Held so the click handler survives garbage collection.
  lastNotification = { notification, title, at: Date.now() };
}

function updateMicPolling(): void {
  const visible = liveWindow(mainWindow)?.isVisible() ?? false;
  if (visible && !micPollTimer) {
    micPollTimer = setInterval(() => permissions.refreshMicrophone(), 1_500);
  } else if (!visible && micPollTimer) {
    clearInterval(micPollTimer);
    micPollTimer = null;
  }
}

async function createMain(showOnReady: boolean): Promise<void> {
  const window = await createMainWindow();
  mainWindow = window;

  window.on('ready-to-show', () => {
    if (showOnReady) showMainWindow();
  });
  window.on('show', updateMicPolling);
  window.on('hide', updateMicPolling);
  // Coming back from System Settings is when permissions and the fn key
  // setting usually just changed.
  window.on('focus', () => {
    void permissions.refresh().then(() => refreshFnKeyAction());
  });
  window.on('close', (event) => {
    if (isQuitting) return;
    // The red button and Cmd+W only hide the window: Yap keeps running in
    // the menu bar, and dictation keeps working.
    event.preventDefault();
    hideMainWindow(window);
  });
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
    updateMicPolling();
  });
  window.webContents.on('render-process-gone', (_event, details) => {
    console.error('[yap] main renderer gone', JSON.stringify(details));
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (showOnReady) showMainWindow();
}

function createAppMenu(): void {
  if (process.platform !== 'darwin') return;
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: 'appMenu' },
      // Close Window (Cmd+W) hides to the menu bar through the close handler.
      { role: 'fileMenu' },
      // Copy and paste in the API key field.
      { role: 'editMenu' },
      ...(app.isPackaged ? [] : [{ role: 'viewMenu' } as const]),
      { role: 'windowMenu' },
    ]),
  );
}

function getTrayIconPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'icons', 'trayTemplate.png')
    : path.join(projectRoot, 'build', 'icons', 'trayTemplate.png');
}

function createTray(): void {
  const icon = nativeImage.createFromPath(getTrayIconPath());
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip('Yap');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Yap', click: () => showMainWindow() },
      { type: 'separator' },
      {
        label: 'Quit Yap',
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on('click', () => showMainWindow());
}

/* ── Engine ─────────────────────────────────────────────────────────────── */

const engine = new DictationEngine(
  {
    getSettings: () => settings,
    getPermissions: () => permissions.get(),
    requestMicrophone: () => {
      void permissions.request('microphone').then((state) => patch({ permissions: state }));
    },
    isLocalModelReady: () => localModel.isReady,
    getRecorder: async () => (await ensureOverlayWindow())?.webContents ?? null,
    setStatus,
    broadcastHistory: (history) => patch({ history }),
    notify,
    notifyHotkey: (down) => sendToMain('hotkey:activity', down),
    ownTextFieldFocused,
  },
  bridge,
);

bridge.on('hotkey', (signal) => engine.handleHotkey(signal));

let grantWatchUntil = 0;
let permissionsBefore: PermissionsState = permissions.get();

/** Called when the user asks for a permission in Yap and is sent to macOS for it. */
function watchForGrant(): void {
  grantWatchUntil = Date.now() + GRANT_WATCH_MS;
}

function newlyGranted(before: PermissionsState, after: PermissionsState): boolean {
  return (
    (before.microphone !== 'granted' && after.microphone === 'granted') ||
    (!before.accessibility && after.accessibility) ||
    (!before.inputMonitoring && after.inputMonitoring)
  );
}

permissions.onChange((state) => {
  patch({ permissions: state });
  const before = permissionsBefore;
  permissionsBefore = state;
  // The user is in System Settings because Yap sent them there: once the
  // switch is on, bring them back. The only time Yap brings itself forward.
  if (Date.now() < grantWatchUntil && newlyGranted(before, state)) {
    showMainWindow();
  }
});

// End-to-end tests drive the hotkey from outside; never present in packaged builds.
if (!app.isPackaged && process.env.YAP_E2E === '1') {
  (globalThis as { __yapE2E?: unknown }).__yapE2E = {
    hotkey: (type: 'down' | 'up') => engine.handleHotkey({ type }),
    ownTextFieldFocused,
  };
}

/* ── Settings ───────────────────────────────────────────────────────────── */

async function updateSettings(updates: UpdateSettingsInput): Promise<AppState> {
  const previous = settings;
  settings = applySettingsUpdate(settings, updates);
  await saveSettings(settings);

  const hotkeyChanged =
    previous.hotkey.keyCode !== settings.hotkey.keyCode || previous.hotkey.modifiers !== settings.hotkey.modifiers;
  if (hotkeyChanged) {
    await bridge.listen(settings.hotkey).catch((error) => console.warn('[yap] listen failed:', error));
  }
  if (previous.launchAtLogin !== settings.launchAtLogin) {
    applyLaunchAtLogin(settings.launchAtLogin);
  }
  if (previous.storageDirectory !== settings.storageDirectory) {
    await ensureStorage(settings);
  }
  if (
    previous.storageDirectory !== settings.storageDirectory ||
    previous.localModel !== settings.localModel ||
    previous.transcriptionMode !== settings.transcriptionMode
  ) {
    await localModel.refresh();
    localModel.warmUp();
  }

  engine.refreshStatus();
  syncOverlay();
  const state = await getState();
  patch({ settings: state.settings, engine: state.engine });
  return state;
}

async function refreshFnKeyAction(): Promise<void> {
  const next = toFnKeyAction(await bridge.getFnUsage());
  if (next !== fnKeyAction) {
    fnKeyAction = next;
    patch({ fnKeyAction });
  }
}

/** Keeps the offered rewrite models in line with what Groq serves this key. */
async function checkGroqModels(): Promise<void> {
  const apiKey = settings ? getGroqApiKey(settings) : null;
  if (!apiKey) return;
  try {
    await refreshGroqModelList(apiKey);
  } catch (error) {
    console.warn('[yap] Groq model list not refreshed:', error instanceof Error ? error.message : error);
  }
}

onGroqModelsChange(() => patch({ engine: engineState() }));

async function runAudioCleanup(): Promise<void> {
  try {
    const sweep = await sweepAudioStore(settings, await loadHistory());
    if (sweep.expiredEntryIds.length > 0) {
      patch({ history: await clearAudioReferences(sweep.expiredEntryIds) });
    }
  } catch (error) {
    console.warn('[yap] audio cleanup failed:', error instanceof Error ? error.message : error);
  }
}

/* ── Startup ────────────────────────────────────────────────────────────── */

function wasOpenedAtLogin(): boolean {
  if (process.argv.includes('--hidden')) return true;
  try {
    return process.platform === 'darwin' && app.getLoginItemSettings().wasOpenedAtLogin === true;
  } catch {
    return false;
  }
}

async function bootstrap(): Promise<void> {
  console.log('[yap] boot', {
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    electron: process.versions.electron,
    logPath: log.transports.file.getFile().path,
  });

  // Carry data over from an install that predates the rename. Must run
  // before the first settings read.
  const migrated = await migrateLegacyUserData(path.join(app.getPath('appData'), 'openwhisp'), app.getPath('userData'));
  if (migrated.length > 0) {
    console.log('[yap] migrated from the previous install:', migrated.join(', '));
  }

  settings = await loadSettings();
  await ensureStorage(settings);
  applyLaunchAtLogin(settings.launchAtLogin);

  registerIpcHandlers({
    engine,
    getState,
    getSettings: () => settings,
    updateSettings,
    saveGroqKey: async (key) => {
      const { models, ...result } = await validateGroqKey(key, settings.cloudModel);
      if (result.valid) {
        settings = withGroqKey(settings, key);
        await saveSettings(settings);
        getGroqApiKey(settings);
        await storeGroqModelList(models ?? []).catch(() => undefined);
        patch({ engine: engineState() });
      }
      return { result, state: await getState() };
    },
    clearGroqKey: async () => {
      settings = withGroqKey(settings, '');
      await saveSettings(settings);
      patch({ engine: engineState() });
      return getState();
    },
    downloadLocalModel: async () => {
      await localModel.downloadSelected();
      localModel.warmUp();
      return getState();
    },
    requestPermission: async (kind) => {
      watchForGrant();
      await permissions.request(kind);
      return getState();
    },
    openPermissionSettings: (kind) => {
      watchForGrant();
      return permissions.openSettings(kind);
    },
    repairPermissions: async () => {
      watchForGrant();
      await permissions.repair();
      return getState();
    },
    refreshPermissions: async () => {
      await permissions.refresh();
      await refreshFnKeyAction();
      return getState();
    },
    openKeyboardSettings: async () => {
      await shell.openExternal(KEYBOARD_SETTINGS_URL).catch(() => undefined);
    },
    chooseStorage: async () => {
      const selected = await chooseStorageDirectory(settings.storageDirectory);
      return selected ? updateSettings({ storageDirectory: selected }) : getState();
    },
    revealStorage: async () => {
      await shell.openPath(settings.storageDirectory);
    },
    showMainWindow,
    isRecorder: (sender) => liveWindow(overlayWindow)?.webContents === sender,
    patch,
  });

  // The helper and the keyboard listener come up while the windows load, so
  // the first paint already knows the real permission state.
  void bridge
    .start()
    .then(async (started) => {
      if (!started) {
        console.warn('[yap] native helper unavailable');
        return;
      }
      await bridge.listen(settings.hotkey).catch((error) => console.warn('[yap] listen failed:', error));
      await permissions.refresh();
      await refreshFnKeyAction();
    })
    .catch((error) => console.error('[yap] native helper failed to start:', error));

  // A login start stays in the menu bar: no window and no Dock icon until the
  // user opens Yap. The packaged app starts as LSUIElement for the same reason.
  const startHidden = settings.setupComplete && wasOpenedAtLogin();
  if (startHidden) setDockVisible(false);
  createAppMenu();
  await Promise.all([createMain(!startHidden), ensureOverlayWindow()]);
  createTray();

  // Warm everything a first dictation would otherwise wait for: the cached
  // stores, the decrypted key (a keychain prompt belongs here, not mid
  // dictation) and, in local mode, the model.
  void Promise.all([loadDictionary(), loadCorrections(), loadAppRules(), loadHistory(), loadGroqModelList()]).then(() =>
    patch({ engine: engineState() }),
  );
  getGroqApiKey(settings);
  void localModel.refresh().then(() => localModel.warmUp());

  engine.refreshStatus();
  setTimeout(() => void runAudioCleanup(), 15_000);
  audioCleanupTimer = setInterval(() => void runAudioCleanup(), AUDIO_CLEANUP_INTERVAL_MS);
  // Off the startup path: the first dictation should not share the network with it.
  setTimeout(() => void checkGroqModels(), 20_000);
  modelCheckTimer = setInterval(() => void checkGroqModels(), MODEL_CHECK_INTERVAL_MS);

  initializeAutoUpdater();
}

async function shutdown(): Promise<void> {
  if (micPollTimer) clearInterval(micPollTimer);
  if (audioCleanupTimer) clearInterval(audioCleanupTimer);
  if (modelCheckTimer) clearInterval(modelCheckTimer);
  micPollTimer = null;
  audioCleanupTimer = null;
  modelCheckTimer = null;
  disposeAutoUpdater();
  bridge.dispose();
  await flushHistory().catch(() => undefined);
  await flushJsonWrites();
}

/* ── App lifecycle ──────────────────────────────────────────────────────── */

// A second instance would start a second helper and paste every dictation twice.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showMainWindow());

  app.whenReady().then(bootstrap).catch((error) => {
    console.error('[yap] startup failed:', error);
  });

  app.on('web-contents-created', (_event, contents) => {
    contents.on('console-message', (event) => {
      if (event.level === 'warning' || event.level === 'error') {
        console.log(`[yap:renderer:${event.level}] ${event.message}`);
      }
    });
  });

  app.on('activate', () => showMainWindow());

  let shutdownDone = false;
  app.on('before-quit', (event) => {
    isQuitting = true;
    if (shutdownDone) return;
    event.preventDefault();
    void shutdown().finally(() => {
      shutdownDone = true;
      app.quit();
    });
  });

  // The window only hides, so this fires on quit at most. Without a listener
  // Electron would quit as soon as the last window is gone.
  app.on('window-all-closed', () => undefined);

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => app.quit());
  }
}
