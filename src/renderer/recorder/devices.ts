import type { MicrophonePreference } from '../../shared/types';

export interface MicrophoneDevice {
  deviceId: string;
  label: string;
  /** The system's default input. */
  isDefault: boolean;
  /** Records what the speakers play (Stereo Mix and the like), never a voice. */
  isLoopback: boolean;
}

/* Chromium lists the system's default and communications devices a second
   time under these ids, with the name prefixed. */
const VIRTUAL_IDS = new Set(['default', 'communications']);
const VIRTUAL_PREFIX = /^(default|standard|communications|kommunikation)\s*-\s*/i;
const LOOPBACK = /stereo ?mix|what u hear|wave ?out|loopback|cable output|was sie hören/i;
const BUILT_IN = /macbook|built-in|integriert/i;

/**
 * A device name that survives a replug: Windows numbers a device again when it
 * comes back on another USB port, "Mikrofon (H2n)" becomes "Mikrofon (2- H2n)".
 */
export function normalizeDeviceLabel(label: string): string {
  return label
    .replace(VIRTUAL_PREFIX, '')
    .replace(/\(\s*\d+\s*-\s*/g, '(')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function isLoopbackLabel(label: string): boolean {
  return LOOPBACK.test(label);
}

/** The real input devices, each once, with the system default marked. */
export function toMicrophones(devices: readonly MediaDeviceInfo[]): MicrophoneDevice[] {
  const inputs = devices.filter((device) => device.kind === 'audioinput');
  const systemDefault = inputs.find((device) => device.deviceId === 'default');
  const defaultLabel = systemDefault ? normalizeDeviceLabel(systemDefault.label) : '';
  const real = inputs.filter((device) => !VIRTUAL_IDS.has(device.deviceId) && device.deviceId !== '');

  return real.map((device, index) => ({
    deviceId: device.deviceId,
    label: device.label,
    isDefault: systemDefault
      ? (defaultLabel !== '' && normalizeDeviceLabel(device.label) === defaultLabel) ||
        (defaultLabel === '' && !!systemDefault.groupId && device.groupId === systemDefault.groupId)
      : index === 0,
    isLoopback: isLoopbackLabel(device.label),
  }));
}

/** The chosen device, matched by id first and by name after a replug. */
export function findPreferred(
  microphones: readonly MicrophoneDevice[],
  preference: MicrophonePreference | null,
): MicrophoneDevice | null {
  if (!preference?.deviceId) return null;
  const byId = microphones.find((device) => device.deviceId === preference.deviceId);
  if (byId) return byId;
  const wanted = normalizeDeviceLabel(preference.label);
  if (!wanted) return null;
  return microphones.find((device) => normalizeDeviceLabel(device.label) === wanted) ?? null;
}

export type MicrophoneChoice =
  /** Record from this device. */
  | { kind: 'device'; device: MicrophoneDevice }
  /** Let the system pick; names are not known yet, so nothing better can be said. */
  | { kind: 'system' }
  /** Only devices that record the speakers are connected. */
  | { kind: 'none' };

/**
 * Which input a recording uses. The user's choice wins while it is connected.
 * Otherwise the system default, except when that is a loopback device such as
 * Stereo Mix: it would transcribe whatever the computer plays. MacBooks get
 * their built-in microphone even with headphones connected: recording through
 * AirPods switches them to the low-quality headset profile for everything else.
 */
export function chooseMicrophone(
  microphones: readonly MicrophoneDevice[],
  preference: MicrophonePreference | null,
  isMac: boolean,
): MicrophoneChoice {
  const preferred = findPreferred(microphones, preference);
  if (preferred) return { kind: 'device', device: preferred };

  // Labels are empty before the first permission grant. With no device at
  // all, opening the default one reports that in the system's own words.
  if (microphones.every((device) => !device.label)) return { kind: 'system' };

  const voices = microphones.filter((device) => !device.isLoopback);
  if (isMac) {
    const builtIn = voices.find((device) => BUILT_IN.test(device.label));
    if (builtIn) return { kind: 'device', device: builtIn };
  }
  const systemDefault = voices.find((device) => device.isDefault);
  if (systemDefault) return { kind: 'device', device: systemDefault };
  if (voices.length > 0) return { kind: 'device', device: voices[0] };
  return { kind: 'none' };
}

export const IS_MAC = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);

export async function listMicrophones(): Promise<MicrophoneDevice[]> {
  return toMicrophones(await navigator.mediaDevices.enumerateDevices());
}

/**
 * Lists the devices, asking for the microphone first when the names are still
 * hidden. The stream is closed again right away.
 */
export async function scanMicrophones(): Promise<MicrophoneDevice[]> {
  const first = await listMicrophones();
  if (first.length > 0 && first.some((device) => device.label)) return first;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const track of stream.getTracks()) track.stop();
  } catch {
    // No device or no permission: the list below says what there is.
  }
  return listMicrophones();
}

export function onDevicesChanged(listener: () => void): () => void {
  const devices = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
  devices?.addEventListener?.('devicechange', listener);
  return () => devices?.removeEventListener?.('devicechange', listener);
}
