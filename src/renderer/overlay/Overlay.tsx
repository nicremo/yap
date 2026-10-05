import { useEffect, useRef, useState } from 'react';

import type { AppStatus } from '../../shared/types';
import { Icon } from '../components/Icon';
import { AudioRecorder, describeMicrophoneError } from '../recorder/recorder';

const BAR_COUNT = 16;

/**
 * Hosts the recorder for main: start, stop and cancel arrive as commands, the
 * finished audio goes back as binary data. Each recording gets its own
 * recorder, so a new dictation can start while the previous one is still
 * being handed over.
 */
function useRecorderHost(onLevel: (level: number) => void): void {
  const levelRef = useRef(onLevel);
  levelRef.current = onLevel;

  useEffect(() => {
    const recorders = new Map<number, AudioRecorder>();
    let latestSession = 0;

    const off = window.yap.onRecorderCommand((command) => {
      const { sessionId } = command;

      if (command.type === 'start') {
        const recorder = new AudioRecorder();
        recorders.set(sessionId, recorder);
        latestSession = sessionId;
        recorder.onLevel = (level) => {
          if (latestSession === sessionId) levelRef.current(level);
        };
        recorder.start(command.encodeOpus).then(
          () => window.yap.sendRecorderEvent({ type: 'started', sessionId }),
          (error: unknown) => {
            recorders.delete(sessionId);
            window.yap.sendRecorderEvent({ type: 'failed', sessionId, message: describeMicrophoneError(error) });
          },
        );
        return;
      }

      const recorder = recorders.get(sessionId);
      recorders.delete(sessionId);
      if (latestSession === sessionId) levelRef.current(0);

      if (command.type === 'cancel') {
        void recorder?.cancel();
        return;
      }

      if (!recorder) {
        window.yap.sendRecorderEvent({ type: 'failed', sessionId, message: 'The microphone did not start.' });
        return;
      }
      recorder.stop().then(
        (result) => window.yap.sendRecordedAudio({ sessionId, ...result }),
        (error: unknown) => window.yap.sendRecorderEvent({ type: 'failed', sessionId, message: describeMicrophoneError(error) }),
      );
    });

    // A reload or teardown must never leave the microphone open.
    const releaseAll = () => {
      for (const recorder of recorders.values()) void recorder.cancel();
      recorders.clear();
    };
    window.addEventListener('pagehide', releaseAll);

    return () => {
      off();
      window.removeEventListener('pagehide', releaseAll);
      releaseAll();
    };
  }, []);
}

export function Overlay() {
  const [status, setStatus] = useState<AppStatus>({ phase: 'idle', title: '', detail: '' });
  const [bars, setBars] = useState<number[]>(() => new Array(BAR_COUNT).fill(0));

  useEffect(() => window.yap.onStatus(setStatus), []);

  useRecorderHost((level) => {
    setBars((previous) => [...previous.slice(1), level]);
  });

  useEffect(() => {
    if (status.phase !== 'listening') setBars(new Array(BAR_COUNT).fill(0));
  }, [status.phase]);

  const phase = status.phase;
  const processing = phase === 'transcribing' || phase === 'rewriting' || phase === 'pasting';

  if (phase === 'idle') {
    return (
      <div className="overlay">
        <div className="pill pill-idle">
          {[0, 1, 2, 3, 4].map((dot) => (
            <span key={dot} className="pill-dot" />
          ))}
        </div>
      </div>
    );
  }

  const label =
    phase === 'listening'
      ? status.handsfree
        ? 'Hands-free'
        : 'Listening'
      : phase === 'done' && status.metrics
        ? `${status.title} · ${(status.metrics.totalMs / 1000).toFixed(2)} s`
        : status.title;

  return (
    <div className="overlay">
      <div className={`pill pill-${phase}${status.handsfree && phase === 'listening' ? ' pill-handsfree' : ''}`}>
        {phase === 'listening' && <span className="pill-rec" />}
        {(phase === 'listening' || processing) && (
          <div className={`wave${processing ? ' wave-processing' : ''}`}>
            {bars.map((value, index) => (
              <span
                key={index}
                style={processing ? { animationDelay: `${index * 70}ms` } : { transform: `scaleY(${0.12 + Math.min(1, value) * 0.88})` }}
              />
            ))}
          </div>
        )}
        {phase === 'done' && <Icon name="check" size={15} strokeWidth={2.75} />}
        {phase === 'error' && <Icon name="alert" size={15} />}
        <span className="pill-label">{label}</span>
      </div>
    </div>
  );
}
