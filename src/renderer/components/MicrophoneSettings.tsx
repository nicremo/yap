import { useCallback, useEffect, useRef, useState } from 'react';

import type { AppState, MicrophonePreference, UpdateSettingsInput } from '../../shared/types';
import { useT } from '../lib/i18n';
import {
  chooseMicrophone,
  findPreferred,
  IS_MAC,
  listMicrophones,
  onDevicesChanged,
  scanMicrophones,
  type MicrophoneDevice,
} from '../recorder/devices';
import { describeMicrophoneError, openMicrophone, resolveMicrophone } from '../recorder/recorder';
import { Button, Field, Notice, Progress } from './ui';

const SOUND_SETTINGS: Record<string, string> = {
  win32: 'ms-settings:sound',
  darwin: 'x-apple.systempreferences:com.apple.preference.sound?input',
};
/** A test that is forgotten must not keep the microphone open. */
const TEST_LIMIT_MS = 20_000;
/** After this long without a sound worth the name, the test says so. */
const SILENCE_HINT_MS = 3_000;
const SILENCE_RMS = 0.01;

/**
 * Lists the levels of an open microphone until stopped. Everything it opens
 * is closed again by the returned function.
 */
function meter(stream: MediaStream, onLevel: (level: number) => void): () => void {
  const context = new AudioContext();
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  const source = context.createMediaStreamSource(stream);
  source.connect(analyser);
  const samples = new Float32Array(analyser.fftSize);
  let frame = 0;
  const tick = () => {
    analyser.getFloatTimeDomainData(samples);
    let sum = 0;
    for (let index = 0; index < samples.length; index += 1) sum += samples[index] * samples[index];
    onLevel(Math.sqrt(sum / samples.length));
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return () => {
    cancelAnimationFrame(frame);
    source.disconnect();
    for (const track of stream.getTracks()) track.stop();
    void context.close().catch(() => undefined);
  };
}

export function MicrophoneSettings({ state, onSave }: { state: AppState; onSave: (patch: UpdateSettingsInput) => void }) {
  const t = useT();
  const { settings } = state;
  const preference: MicrophonePreference | null = settings.microphoneId
    ? { deviceId: settings.microphoneId, label: settings.microphoneLabel }
    : null;

  const [devices, setDevices] = useState<MicrophoneDevice[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [testing, setTesting] = useState(false);
  const [level, setLevel] = useState(0);
  const [silent, setSilent] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const stopTest = useRef<(() => void) | null>(null);

  const reload = useCallback(async (askFirst: boolean) => {
    try {
      setDevices(askFirst ? await scanMicrophones() : await listMicrophones());
    } catch {
      setDevices([]);
    }
  }, []);

  const endTest = useCallback(() => {
    stopTest.current?.();
    stopTest.current = null;
    setTesting(false);
    setLevel(0);
  }, []);

  // Plugging a device in or out updates the list by itself.
  useEffect(() => {
    void reload(false);
    const off = onDevicesChanged(() => void reload(false));
    return () => {
      off();
      stopTest.current?.();
    };
  }, [reload]);

  const scan = async () => {
    setScanning(true);
    await reload(true);
    setScanning(false);
  };

  const startTest = async () => {
    endTest();
    setTestError(null);
    setSilent(false);
    try {
      const stream = await openMicrophone(await resolveMicrophone(preference));
      setTesting(true);
      const startedAt = performance.now();
      let peak = 0;
      const stopMeter = meter(stream, (rms) => {
        peak = Math.max(peak, rms);
        setLevel(Math.min(1, rms * 6));
        if (performance.now() - startedAt > SILENCE_HINT_MS) setSilent(peak < SILENCE_RMS);
      });
      const limit = setTimeout(endTest, TEST_LIMIT_MS);
      stopTest.current = () => {
        clearTimeout(limit);
        stopMeter();
      };
      // The names are readable now; refresh them in case they were hidden.
      void reload(false);
    } catch (error) {
      setTestError(describeMicrophoneError(error, t.microphone));
      setTesting(false);
    }
  };

  const select = (deviceId: string) => {
    endTest();
    const device = devices?.find((entry) => entry.deviceId === deviceId);
    if (!deviceId || !device) {
      onSave({ microphoneId: '', microphoneLabel: '' });
      return;
    }
    onSave({ microphoneId: device.deviceId, microphoneLabel: device.label });
  };

  const list = devices ?? [];
  const preferred = findPreferred(list, preference);
  const missing = preference !== null && devices !== null && !preferred;
  const choice = chooseMicrophone(list, preference, IS_MAC);
  const noVoice = devices !== null && list.filter((device) => !device.isLoopback).length === 0;
  const namesHidden = list.length > 0 && list.every((device) => !device.label);
  const soundSettings = SOUND_SETTINGS[state.platform];

  const name = (device: MicrophoneDevice, index: number) => device.label || t.settings.microphoneUnnamed(index + 1);
  const describe = (device: MicrophoneDevice, index: number) => {
    const tags = [
      device.isDefault ? t.settings.microphoneDefaultTag : '',
      device.isLoopback ? t.settings.microphoneLoopbackTag : '',
    ].filter(Boolean);
    return tags.length > 0 ? `${name(device, index)} (${tags.join(', ')})` : name(device, index);
  };

  return (
    <div className="stack">
      <Field label={t.settings.microphoneDevice} hint={t.settings.microphoneHint}>
        <select
          className="select"
          value={preferred?.deviceId ?? settings.microphoneId}
          onChange={(event) => select(event.target.value)}
        >
          <option value="">{t.settings.microphoneAutomatic}</option>
          {list.map((device, index) => (
            <option key={device.deviceId} value={device.deviceId}>
              {describe(device, index)}
            </option>
          ))}
          {missing && (
            <option value={settings.microphoneId}>{t.settings.microphoneMissing(settings.microphoneLabel || settings.microphoneId)}</option>
          )}
        </select>
      </Field>

      <div className="row">
        <div className="row-text">
          <strong role="status">
            {choice.kind === 'device'
              ? t.settings.microphoneRecordsFrom(name(choice.device, list.indexOf(choice.device)))
              : choice.kind === 'system'
                ? t.settings.microphoneRecordsFromSystem
                : t.settings.microphoneRecordsFromNone}
          </strong>
          <span>{testing ? (silent ? t.settings.microphoneSilent : t.settings.microphoneTestHint) : t.settings.microphoneTestIdle}</span>
        </div>
        <div className="button-row">
          <Button size="sm" variant="ghost" icon="search" busy={scanning} onClick={() => void scan()}>
            {t.settings.microphoneScan}
          </Button>
          <Button size="sm" variant="secondary" icon="mic" onClick={() => (testing ? endTest() : void startTest())}>
            {testing ? t.settings.microphoneStopTest : t.settings.microphoneTest}
          </Button>
        </div>
      </div>
      {testing && <Progress value={level} label={t.settings.microphoneLevel} />}

      {testError && <Notice tone="danger">{testError}</Notice>}
      {missing && <Notice tone="warning">{t.settings.microphoneNotConnected}</Notice>}
      {namesHidden && <Notice tone="neutral">{t.settings.microphoneNamesHidden}</Notice>}
      {noVoice && (
        <Notice
          tone="warning"
          action={
            soundSettings && (
              <Button size="sm" variant="ghost" icon="external" onClick={() => void window.yap.openExternal(soundSettings)}>
                {t.settings.microphoneSoundSettings}
              </Button>
            )
          }
        >
          {t.settings.microphoneNone}
        </Notice>
      )}
    </div>
  );
}
