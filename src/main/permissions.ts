import { shell, systemPreferences } from 'electron';

import type { PermissionsState } from '../shared/types';
import { getNativePermissionState, requestNativePermissions } from './native-helper';

const isMac = process.platform === 'darwin';

const MICROPHONE_SETTINGS_URL =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone';
const ACCESSIBILITY_SETTINGS_URL =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility';
const INPUT_MONITORING_SETTINGS_URL =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent';
const WINDOWS_MICROPHONE_SETTINGS_URL = 'ms-settings:privacy-microphone';

async function openSettingsPane(targetUrl: string): Promise<void> {
  try {
    await shell.openExternal(targetUrl);
  } catch {
    // Ignore settings URL failures and still return the current permission state.
  }
}

function getMicrophoneStatus(): PermissionsState['microphone'] {
  try {
    const microphone = systemPreferences.getMediaAccessStatus('microphone');
    if (
      microphone === 'granted' ||
      microphone === 'denied' ||
      microphone === 'restricted' ||
      microphone === 'not-determined'
    ) {
      return microphone;
    }
  } catch {
    // getMediaAccessStatus can throw on unsupported platforms.
  }
  return 'unknown';
}

export async function getPermissionState(): Promise<PermissionsState> {
  const nativePermissions = await getNativePermissionState();
  const microphone = getMicrophoneStatus();
  console.log('[openwhisp] mic status:', microphone, '| native:', JSON.stringify(nativePermissions));

  return {
    microphone,
    accessibility: nativePermissions.accessibility,
    inputMonitoring: nativePermissions.inputMonitoring,
    postEvents: nativePermissions.postEvents,
  };
}

async function waitForMicrophoneAccess(attempts = 5): Promise<PermissionsState> {
  for (let i = 0; i < attempts; i++) {
    const state = await getPermissionState();
    if (state.microphone === 'granted') return state;
    await new Promise((r) => setTimeout(r, 500));
  }
  return getPermissionState();
}

export async function requestMicrophoneAccess(): Promise<PermissionsState> {
  const currentState = await getPermissionState();

  if (currentState.microphone === 'granted') {
    return currentState;
  }

  if (isMac && currentState.microphone === 'not-determined') {
    try {
      const granted = await systemPreferences.askForMediaAccess('microphone');
      if (granted) {
        return waitForMicrophoneAccess();
      }
    } catch {
      // Electron throws when the permission cannot be requested from the current context.
    }
  }

  await openSettingsPane(isMac ? MICROPHONE_SETTINGS_URL : WINDOWS_MICROPHONE_SETTINGS_URL);
  return waitForMicrophoneAccess(15);
}

async function waitForSystemAccess(attempts = 10): Promise<PermissionsState> {
  for (let i = 0; i < attempts; i++) {
    const state = await getPermissionState();
    if (state.accessibility && state.inputMonitoring && state.postEvents) return state;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return getPermissionState();
}

export async function requestSystemAccess(): Promise<PermissionsState> {
  // On Windows the native helper reports all system permissions as granted.
  if (!isMac) {
    return getPermissionState();
  }

  await requestNativePermissions();
  const nextState = await getPermissionState();

  if (!nextState.accessibility || !nextState.postEvents) {
    await openSettingsPane(ACCESSIBILITY_SETTINGS_URL);
  } else if (!nextState.inputMonitoring) {
    await openSettingsPane(INPUT_MONITORING_SETTINGS_URL);
  }

  return waitForSystemAccess();
}
