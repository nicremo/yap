import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { app, shell, systemPreferences } from 'electron';

import type { FnKeyAction, MicrophoneStatus, PermissionKind, PermissionsState } from '../shared/types';
import type { ListenerStatus, NativeBridge, NativePermissions } from './native';

const execFileAsync = promisify(execFile);
const isMac = process.platform === 'darwin';
/** How long a system permission dialog gets to appear and take focus from Yap. */
const DIALOG_GRACE_MS = 800;
const isWindows = process.platform === 'win32';

const SETTINGS_URLS: Record<PermissionKind, string> = isWindows
  ? {
      microphone: 'ms-settings:privacy-microphone',
      accessibility: 'ms-settings:privacy',
      inputMonitoring: 'ms-settings:privacy',
    }
  : {
      microphone: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
      accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
      inputMonitoring: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent',
    };

export const KEYBOARD_SETTINGS_URL = 'x-apple.systempreferences:com.apple.Keyboard-Settings.extension';

/* The TCC services Yap uses, by tccutil name. */
const TCC_SERVICES: Record<PermissionKind, string[]> = {
  microphone: ['Microphone'],
  accessibility: ['Accessibility', 'PostEvent'],
  inputMonitoring: ['ListenEvent'],
};

function readMicrophoneStatus(): MicrophoneStatus {
  if (!isMac && !isWindows) {
    return 'granted';
  }
  try {
    const status = systemPreferences.getMediaAccessStatus('microphone');
    if (status === 'granted' || status === 'denied' || status === 'restricted' || status === 'not-determined') {
      return status;
    }
  } catch {
    // Not supported on this platform.
  }
  return 'unknown';
}

export function toFnKeyAction(value: number | null): FnKeyAction | null {
  switch (value) {
    case null:
      return null;
    case 0:
      return 'nothing';
    case 1:
      return 'input-source';
    case 2:
      return 'emoji';
    case 3:
      return 'dictation';
    default:
      return 'unknown';
  }
}

/**
 * Single source of truth for what the OS allows. Microphone status comes from
 * Electron, everything else from the native helper, which watches its own
 * permissions and reports changes as they happen. The hotkey counts as
 * working only when the listener actually runs, not when a preflight call
 * claims it should.
 */
export interface PermissionsHost {
  /** A Yap window has keyboard focus. A system dialog that appears takes it away. */
  appHasFocus(): boolean;
}

export class PermissionsService {
  private state: PermissionsState;
  private readonly listeners = new Set<(state: PermissionsState) => void>();
  private lastNative: NativePermissions | null = null;
  private stuckTimer: ReturnType<typeof setTimeout> | null = null;
  private restartedFor: string | null = null;

  constructor(
    private readonly bridge: NativeBridge,
    private readonly host: PermissionsHost = { appHasFocus: () => false },
  ) {
    this.state = {
      microphone: readMicrophoneStatus(),
      accessibility: !isMac,
      inputMonitoring: !isMac,
      hotkeyActive: false,
      hotkeyError: null,
      nativePermissionsRequired: isMac,
    };

    bridge.on('permissions', (permissions) => this.applyNative(permissions));
    bridge.on('listener', (status) => this.applyListener(status));
  }

  get(): PermissionsState {
    return this.state;
  }

  onChange(listener: (state: PermissionsState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private set(next: PermissionsState): void {
    const changed = (Object.keys(next) as Array<keyof PermissionsState>).some((key) => next[key] !== this.state[key]);
    this.state = next;
    if (changed) {
      for (const listener of this.listeners) listener(next);
    }
  }

  private applyNative(permissions: NativePermissions): void {
    this.lastNative = permissions;
    this.set({
      ...this.state,
      accessibility: permissions.accessibility,
      inputMonitoring: permissions.inputMonitoring,
    });
    this.watchForStuckListener();
  }

  private applyListener(status: ListenerStatus): void {
    this.set({ ...this.state, hotkeyActive: status.active, hotkeyError: status.active ? null : status.error });
    this.watchForStuckListener();
  }

  /* macOS sometimes only honours a fresh grant in a fresh process. When the
     permissions say the listener should work but it does not start, give the
     helper a clean start once. */
  private watchForStuckListener(): void {
    if (this.stuckTimer) {
      clearTimeout(this.stuckTimer);
      this.stuckTimer = null;
    }
    const native = this.lastNative;
    if (!native || this.state.hotkeyActive || !(native.accessibility || native.inputMonitoring)) {
      return;
    }
    // Once per permission state, so a listener that fails for another reason
    // cannot turn this into a restart loop.
    const key = `${native.accessibility}:${native.inputMonitoring}`;
    if (this.restartedFor === key) {
      return;
    }
    this.stuckTimer = setTimeout(() => {
      this.stuckTimer = null;
      if (!this.state.hotkeyActive && this.restartedFor !== key) {
        this.restartedFor = key;
        console.log('[yap] permissions granted but listener inactive, restarting helper');
        void this.bridge.restart();
      }
    }, 2_500);
  }

  /** Re-reads everything. Cheap: one Electron call and one helper round trip. */
  async refresh(): Promise<PermissionsState> {
    const microphone = readMicrophoneStatus();
    let native = this.lastNative;
    try {
      native = await this.bridge.getPermissions();
      this.lastNative = native;
    } catch {
      // Keep the last known values while the helper restarts.
    }
    const listener = this.bridge.getListenerStatus();
    this.set({
      ...this.state,
      microphone,
      accessibility: native?.accessibility ?? this.state.accessibility,
      inputMonitoring: native?.inputMonitoring ?? this.state.inputMonitoring,
      hotkeyActive: listener.active,
      hotkeyError: listener.active ? null : listener.error,
    });
    return this.state;
  }

  /** Only the microphone, without touching the helper. Used for frequent polling. */
  refreshMicrophone(): void {
    const microphone = readMicrophoneStatus();
    if (microphone !== this.state.microphone) {
      this.set({ ...this.state, microphone });
    }
  }

  async openSettings(kind: PermissionKind): Promise<void> {
    try {
      await shell.openExternal(SETTINGS_URLS[kind]);
    } catch {
      // A missing settings pane is not worth an error dialog.
    }
  }

  private isGranted(kind: PermissionKind): boolean {
    if (kind === 'microphone') return this.state.microphone === 'granted';
    return kind === 'accessibility' ? this.state.accessibility : this.state.inputMonitoring;
  }

  /**
   * One piece of system UI per click: the system dialog, or System Settings,
   * never both. Two windows at once used to bury Yap under System Settings.
   */
  async request(kind: PermissionKind): Promise<PermissionsState> {
    if (kind === 'microphone') {
      const status = readMicrophoneStatus();
      if (isMac && status === 'not-determined') {
        // Shows the system prompt. Nothing else to do when it gets answered.
        await systemPreferences.askForMediaAccess('microphone').catch(() => false);
      } else if (status !== 'granted') {
        await this.openSettings('microphone');
      }
      return this.refresh();
    }

    if (!isMac) {
      return this.refresh();
    }

    // The dialog registers Yap in the list and has its own button to System
    // Settings. macOS shows it only once for Input Monitoring though: when no
    // dialog takes focus from Yap, this click opens the pane instead.
    const focusedBefore = this.host.appHasFocus();
    try {
      if (kind === 'accessibility') {
        await this.bridge.requestAccessibility();
      } else {
        await this.bridge.requestInputMonitoring();
      }
    } catch {
      await this.openSettings(kind);
      return this.refresh();
    }

    await this.refresh();
    if (focusedBefore && !this.isGranted(kind)) {
      await new Promise((resolve) => setTimeout(resolve, DIALOG_GRACE_MS));
      await this.refresh();
      if (!this.isGranted(kind) && this.host.appHasFocus()) {
        await this.openSettings(kind);
      }
    }
    return this.state;
  }

  /**
   * Clears Yap's entries from the privacy database. Needed when System
   * Settings shows Yap as allowed but macOS no longer honours it, which
   * happens after an update replaces an unsigned app: the entry belongs to
   * the old binary.
   */
  async repair(): Promise<PermissionsState> {
    if (!isMac || !app.isPackaged) {
      return this.refresh();
    }

    const bundleId = 'ai.yap.desktop';
    const kinds: PermissionKind[] = [];
    if (!this.state.accessibility) kinds.push('accessibility');
    if (!this.state.inputMonitoring) kinds.push('inputMonitoring');
    if (this.state.microphone === 'denied') kinds.push('microphone');
    if (kinds.length === 0) kinds.push('accessibility', 'inputMonitoring');

    for (const kind of kinds) {
      for (const service of TCC_SERVICES[kind]) {
        await execFileAsync('/usr/bin/tccutil', ['reset', service, bundleId]).catch((error) => {
          console.warn('[yap] tccutil reset failed:', service, error instanceof Error ? error.message : error);
        });
      }
    }

    await this.bridge.restart();
    if (kinds.includes('accessibility')) {
      return this.request('accessibility');
    }
    if (kinds.includes('microphone')) {
      return this.request('microphone');
    }
    return this.refresh();
  }
}
