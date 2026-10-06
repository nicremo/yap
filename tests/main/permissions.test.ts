import { EventEmitter } from 'node:events';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { NativePermissions } from '../../src/main/native';

const electron = vi.hoisted(() => ({
  opened: [] as string[],
  micStatus: 'granted' as string,
  askedForMic: 0,
}));

vi.mock('electron', async (importOriginal) => ({
  ...(await importOriginal<typeof import('electron')>()),
  shell: {
    openExternal: async (url: string) => {
      electron.opened.push(url);
    },
  },
  systemPreferences: {
    getMediaAccessStatus: () => electron.micStatus,
    askForMediaAccess: async () => {
      electron.askedForMic += 1;
      return true;
    },
  },
}));

const realPlatform = process.platform;
let PermissionsService: typeof import('../../src/main/permissions').PermissionsService;

beforeAll(async () => {
  // The service reads the platform at import time.
  Object.defineProperty(process, 'platform', { value: 'darwin' });
  vi.resetModules();
  ({ PermissionsService } = await import('../../src/main/permissions'));
});

afterAll(() => {
  Object.defineProperty(process, 'platform', { value: realPlatform });
});

class FakeBridge extends EventEmitter {
  native: NativePermissions = { accessibility: false, inputMonitoring: false, postEvents: false };
  requests: string[] = [];
  /** What the system does when asked: show a dialog (takes focus), or nothing. */
  onRequest: () => void = () => undefined;

  async getPermissions() {
    return this.native;
  }
  getListenerStatus() {
    return { active: false, mode: null, error: 'Waiting' };
  }
  async requestAccessibility() {
    this.requests.push('accessibility');
    this.onRequest();
    return this.native;
  }
  async requestInputMonitoring() {
    this.requests.push('inputMonitoring');
    this.onRequest();
    return this.native;
  }
  async restart() {
    return true;
  }
}

let bridge: FakeBridge;
let focused: boolean;

function service() {
  return new PermissionsService(bridge as never, { appHasFocus: () => focused });
}

beforeEach(() => {
  bridge = new FakeBridge();
  focused = true;
  electron.opened = [];
  electron.micStatus = 'granted';
  electron.askedForMic = 0;
});

describe('PermissionsService.request', () => {
  it('shows only the system dialog when one comes up', async () => {
    bridge.onRequest = () => {
      focused = false; // the dialog takes focus from Yap
    };
    await service().request('accessibility');

    expect(bridge.requests).toEqual(['accessibility']);
    expect(electron.opened).toEqual([]);
  });

  it('opens System Settings instead when macOS shows no dialog', async () => {
    await service().request('inputMonitoring');

    expect(bridge.requests).toEqual(['inputMonitoring']);
    expect(electron.opened).toEqual(['x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent']);
  });

  it('opens nothing more when the permission arrives right away', async () => {
    bridge.onRequest = () => {
      bridge.native = { ...bridge.native, accessibility: true };
    };
    await service().request('accessibility');

    expect(electron.opened).toEqual([]);
  });

  it('asks for the microphone with the system prompt only', async () => {
    electron.micStatus = 'not-determined';
    await service().request('microphone');

    expect(electron.askedForMic).toBe(1);
    expect(electron.opened).toEqual([]);
  });

  it('sends a denied microphone straight to System Settings', async () => {
    electron.micStatus = 'denied';
    await service().request('microphone');

    expect(electron.askedForMic).toBe(0);
    expect(electron.opened).toEqual(['x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone']);
  });
});
