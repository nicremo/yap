import { describe, expect, it } from 'vitest';

import { chooseMicrophone, normalizeDeviceLabel, toMicrophones } from '../../src/renderer/recorder/devices';

const input = (deviceId: string, label: string, groupId = deviceId) =>
  ({ kind: 'audioinput', deviceId, label, groupId }) as MediaDeviceInfo;

/* What Chromium lists on a Windows PC with only the onboard Stereo Mix and
   the Zoom H2n connected. */
const WINDOWS = [
  input('default', 'Standard - Stereomix (2- Realtek High Definition Audio)', 'realtek'),
  input('communications', 'Kommunikation - Stereomix (2- Realtek High Definition Audio)', 'realtek'),
  input('mix', 'Stereomix (2- Realtek High Definition Audio)', 'realtek'),
  input('h2n', 'Mikrofon (H2n)', 'zoom'),
  { kind: 'audiooutput', deviceId: 'speakers', label: 'Lautsprecher', groupId: 'realtek' } as MediaDeviceInfo,
];

describe('toMicrophones', () => {
  it('lists each real input once and marks the default and loopback devices', () => {
    expect(toMicrophones(WINDOWS)).toEqual([
      { deviceId: 'mix', label: 'Stereomix (2- Realtek High Definition Audio)', isDefault: true, isLoopback: true },
      { deviceId: 'h2n', label: 'Mikrofon (H2n)', isDefault: false, isLoopback: false },
    ]);
  });
});

describe('normalizeDeviceLabel', () => {
  it('matches a device that Windows numbered again on another USB port', () => {
    expect(normalizeDeviceLabel('Mikrofon (2- H2n)')).toBe(normalizeDeviceLabel('Mikrofon (H2n)'));
    expect(normalizeDeviceLabel('Standard - Mikrofon (H2n)')).toBe('mikrofon (h2n)');
  });
});

describe('chooseMicrophone', () => {
  const microphones = toMicrophones(WINDOWS);

  it('skips a Stereo Mix default for a real microphone', () => {
    expect(chooseMicrophone(microphones, null, false)).toMatchObject({ kind: 'device', device: { deviceId: 'h2n' } });
  });

  it('finds the chosen device by id, then by name after a replug', () => {
    expect(chooseMicrophone(microphones, { deviceId: 'h2n', label: 'Mikrofon (H2n)' }, false)).toMatchObject({
      device: { deviceId: 'h2n' },
    });
    expect(chooseMicrophone(microphones, { deviceId: 'old-port', label: 'Mikrofon (3- H2n)' }, false)).toMatchObject({
      device: { deviceId: 'h2n' },
    });
  });

  it('honours an explicit loopback choice', () => {
    expect(chooseMicrophone(microphones, { deviceId: 'mix', label: '' }, false)).toMatchObject({ device: { deviceId: 'mix' } });
  });

  it('falls back to the automatic choice while the chosen device is unplugged', () => {
    expect(chooseMicrophone(microphones, { deviceId: 'gone', label: 'USB Headset' }, false)).toMatchObject({
      device: { deviceId: 'h2n' },
    });
  });

  it('reports no microphone when only loopback devices are connected', () => {
    expect(chooseMicrophone(toMicrophones(WINDOWS.slice(0, 3)), null, false)).toEqual({ kind: 'none' });
  });

  it('leaves the choice to the system while names are hidden', () => {
    expect(chooseMicrophone(toMicrophones([input('a', ''), input('b', '')]), null, false)).toEqual({ kind: 'system' });
    expect(chooseMicrophone([], null, false)).toEqual({ kind: 'system' });
  });

  it('prefers the built-in microphone on a Mac only', () => {
    const mac = toMicrophones([
      input('default', 'Default - AirPods Pro', 'airpods'),
      input('airpods', 'AirPods Pro', 'airpods'),
      input('built-in', 'MacBook Pro Microphone'),
    ]);
    expect(chooseMicrophone(mac, null, true)).toMatchObject({ device: { deviceId: 'built-in' } });
    expect(chooseMicrophone(mac, null, false)).toMatchObject({ device: { deviceId: 'airpods' } });
  });
});
