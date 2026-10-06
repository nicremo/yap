import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({ check: vi.fn(), install: vi.fn(), packaged: true }));
vi.mock('electron', () => ({ app: { get isPackaged() { return mocked.packaged; } }, Notification: { isSupported: () => false } }));
vi.mock('electron-log/main.js', () => ({ default: { info: vi.fn(), error: vi.fn() } }));
vi.mock('../../src/main/i18n', () => ({ t: () => ({ updater: { ready: '', readyBody: () => '' } }) }));
vi.mock('electron-updater', async () => {
  const { EventEmitter } = await import('node:events');
  return { default: { autoUpdater: Object.assign(new EventEmitter(), { checkForUpdates: mocked.check, quitAndInstall: mocked.install }) } };
});
import electronUpdater from 'electron-updater';
import { checkForUpdatesManually, disposeAutoUpdater, getUpdaterState, initializeAutoUpdater, installDownloadedUpdate } from '../../src/main/updater';
const emitter = electronUpdater.autoUpdater as unknown as EventEmitter;

describe('automatic updates', () => {
  beforeEach(() => { vi.useFakeTimers(); mocked.packaged = true; mocked.check.mockReset().mockResolvedValue(null); mocked.install.mockReset(); });
  afterEach(() => { disposeAutoUpdater(); vi.useRealTimers(); });
  it('initializes on macOS and checks after launch and periodically', async () => {
    initializeAutoUpdater();
    await vi.advanceTimersByTimeAsync(3000);
    expect(mocked.check).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4 * 60 * 60 * 1000);
    expect(mocked.check).toHaveBeenCalledTimes(2);
  });
  it('never contacts the update feed in development', async () => {
    mocked.packaged = false;
    initializeAutoUpdater();
    await checkForUpdatesManually();
    expect(getUpdaterState().kind).toBe('disabled');
    expect(mocked.check).not.toHaveBeenCalled();
  });
  it('coalesces concurrent checks and permits retry after network errors', async () => {
    let finish!: () => void;
    mocked.check.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    initializeAutoUpdater();
    const first = checkForUpdatesManually();
    const second = checkForUpdatesManually();
    expect(mocked.check).toHaveBeenCalledTimes(1);
    finish(); await Promise.all([first, second]);
    mocked.check.mockRejectedValueOnce(new Error('offline'));
    await checkForUpdatesManually(); expect(getUpdaterState().kind).toBe('error');
    mocked.check.mockImplementationOnce(async () => emitter.emit('update-not-available', { version: '1.1.1' }));
    await checkForUpdatesManually(); expect(getUpdaterState().kind).toBe('current');
  });
  it('broadcasts progress and only restarts with a downloaded update and no dictation', async () => {
    const changed = vi.fn(); initializeAutoUpdater(changed);
    expect(installDownloadedUpdate(true)).toBe(false);
    emitter.emit('update-available', { version: '1.2.0' });
    emitter.emit('download-progress', { percent: 41.6 });
    expect(changed).toHaveBeenLastCalledWith({ kind: 'downloading', version: '1.2.0', percent: 42 });
    emitter.emit('update-downloaded', { version: '1.2.0' });
    expect(installDownloadedUpdate(false)).toBe(false);
    expect(installDownloadedUpdate(true)).toBe(true);
    await vi.runOnlyPendingTimersAsync();
    expect(mocked.install).toHaveBeenCalledWith(false, true);
    await checkForUpdatesManually(); expect(mocked.check).not.toHaveBeenCalled();
  });
  it('cleans up timers and listeners without accumulating duplicate handlers', async () => {
    initializeAutoUpdater(); disposeAutoUpdater();
    await vi.advanceTimersByTimeAsync(3000); expect(mocked.check).not.toHaveBeenCalled();
    expect(emitter.listenerCount('update-available')).toBe(0);
    initializeAutoUpdater(); initializeAutoUpdater();
    expect(emitter.listenerCount('update-available')).toBe(1);
  });
});
