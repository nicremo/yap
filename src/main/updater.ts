import { app, Notification } from 'electron';
import log from 'electron-log/main.js';
// electron-updater is published as a CommonJS module with no "exports"
// field, so Node's strict ESM loader rejects named imports at runtime
// (TypeScript + esModuleInterop quietly accept them, which is why this
// only surfaced in the packaged build). Import the default and destructure.
import electronUpdater from 'electron-updater';
import type { ProgressInfo, UpdateInfo } from 'electron-updater';

const { autoUpdater } = electronUpdater;

const FIRST_CHECK_DELAY_MS = 3_000;
const PERIODIC_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
const MAX_LOG_SIZE = 5 * 1024 * 1024;

export type UpdaterState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'available'; info: UpdateInfo }
  | { kind: 'downloading'; info: UpdateInfo; percent: number }
  | { kind: 'downloaded'; info: UpdateInfo }
  | { kind: 'error'; message: string };

let state: UpdaterState = { kind: 'idle' };
let periodicHandle: ReturnType<typeof setInterval> | null = null;
let initialized = false;

export function getUpdaterState(): UpdaterState {
  return state;
}

export function initializeAutoUpdater(): void {
  if (initialized) {
    return;
  }

  if (!app.isPackaged) {
    log.info('[openwhisp:updater] skipped (development build)');
    return;
  }

  // macOS auto-update requires a signed and notarized build served with a
  // valid Apple Developer ID certificate. Until that pipeline lands we skip
  // the updater on macOS to avoid throwing noisy errors at users.
  if (process.platform === 'darwin') {
    log.info('[openwhisp:updater] skipped on macOS until code signing is wired up');
    return;
  }

  // Route electron-updater's internal logger through our persisted log file
  // so update failures show up alongside the rest of the main-process log.
  autoUpdater.logger = log;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowDowngrade = false;
  autoUpdater.allowPrerelease = false;

  autoUpdater.on('checking-for-update', () => {
    state = { kind: 'checking' };
    log.info('[openwhisp:updater] checking-for-update');
  });

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    state = { kind: 'available', info };
    log.info('[openwhisp:updater] update-available', {
      version: info.version,
      releaseDate: info.releaseDate,
    });
  });

  autoUpdater.on('update-not-available', (info: UpdateInfo) => {
    state = { kind: 'idle' };
    log.info('[openwhisp:updater] up-to-date', { version: info.version });
  });

  autoUpdater.on('download-progress', (progress: ProgressInfo) => {
    const percent = Math.round(progress.percent);
    if (state.kind === 'downloading' && state.percent === percent) {
      return;
    }
    const info = state.kind === 'available' || state.kind === 'downloading' ? state.info : undefined;
    state = info ? { kind: 'downloading', info, percent } : state;
    log.info('[openwhisp:updater] download-progress', {
      percent,
      bytesPerSecond: Math.round(progress.bytesPerSecond),
      transferred: progress.transferred,
      total: progress.total,
    });
  });

  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    state = { kind: 'downloaded', info };
    log.info('[openwhisp:updater] update-downloaded', { version: info.version });
    notifyUpdateReady(info.version);
  });

  autoUpdater.on('error', (error: Error) => {
    state = { kind: 'error', message: error.message };
    log.error('[openwhisp:updater] error', error);
  });

  // First check is delayed so launch I/O finishes before the updater hits
  // the network. Subsequent checks happen on a long interval so long-running
  // sessions still pick up releases without hammering the feed.
  setTimeout(() => {
    void runCheck('startup');
  }, FIRST_CHECK_DELAY_MS);

  periodicHandle = setInterval(() => {
    void runCheck('interval');
  }, PERIODIC_CHECK_INTERVAL_MS);

  initialized = true;
  log.info('[openwhisp:updater] initialized', {
    maxLogSize: MAX_LOG_SIZE,
    firstCheckDelayMs: FIRST_CHECK_DELAY_MS,
    periodicIntervalMs: PERIODIC_CHECK_INTERVAL_MS,
  });
}

export function disposeAutoUpdater(): void {
  if (periodicHandle !== null) {
    clearInterval(periodicHandle);
    periodicHandle = null;
  }
}

export async function checkForUpdatesManually(): Promise<UpdaterState> {
  await runCheck('manual');
  return state;
}

async function runCheck(trigger: 'startup' | 'interval' | 'manual'): Promise<void> {
  try {
    log.info('[openwhisp:updater] check triggered', { trigger });
    await autoUpdater.checkForUpdates();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    state = { kind: 'error', message };
    log.error('[openwhisp:updater] check failed', { trigger, message });
  }
}

function notifyUpdateReady(version: string): void {
  if (!Notification.isSupported()) {
    return;
  }

  const notification = new Notification({
    title: 'OpenWhisp update ready',
    body: `Version ${version} will be installed the next time you quit OpenWhisp.`,
    silent: false,
  });

  notification.show();
}
