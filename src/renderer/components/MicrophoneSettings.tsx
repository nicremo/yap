import { useEffect, useState } from 'react';

import { useT } from '../lib/i18n';
import { describeMicrophoneError } from '../recorder/recorder';
import { Button, Card, Field, Notice } from './ui';

async function listMicrophones(): Promise<MediaDeviceInfo[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((device) =>
    device.kind === 'audioinput' && device.label && device.deviceId &&
    device.deviceId !== 'default' && device.deviceId !== 'communications',
  );
}

export function MicrophoneSettings({ deviceId, saving, onChange }: {
  deviceId: string | null;
  saving: boolean;
  onChange: (deviceId: string | null) => void;
}) {
  const t = useT();
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices) return;
    let active = true;
    let latestRequest = 0;
    const refresh = async () => {
      const request = ++latestRequest;
      const inputs = await listMicrophones().catch(() => []);
      if (active && request === latestRequest) setDevices(inputs);
    };
    void refresh();
    mediaDevices.addEventListener('devicechange', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      active = false;
      mediaDevices.removeEventListener('devicechange', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, []);

  async function detect() {
    setLoading(true);
    setError('');
    try {
      // Chromium may hide device names until this window has opened an input.
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      try {
        setDevices(await listMicrophones());
      } finally {
        for (const track of stream.getTracks()) track.stop();
      }
    } catch (cause) {
      setError(describeMicrophoneError(cause, t.microphone));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card title={t.settings.microphone} action={
      devices.length === 0 && (
        <Button size="sm" variant="ghost" busy={loading} onClick={() => void detect()}>
          {t.settings.microphoneLoad}
        </Button>
      )
    }>
      <Field label={t.settings.microphoneInput} hint={t.settings.microphoneHint}>
        <select
          className="select"
          value={deviceId ?? ''}
          disabled={saving}
          onChange={(event) => onChange(event.target.value || null)}
        >
          <option value="">{t.settings.microphoneAuto}</option>
          {deviceId && !devices.some((device) => device.deviceId === deviceId) && (
            <option value={deviceId} disabled>{t.settings.microphoneUnavailable}</option>
          )}
          {devices.map((device) => (
            <option key={device.deviceId} value={device.deviceId}>{device.label}</option>
          ))}
        </select>
      </Field>
      {error && <Notice tone="danger">{error}</Notice>}
    </Card>
  );
}
