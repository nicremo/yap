import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import type { AppStatus } from '../../shared/types';
import { Icon } from '../components/Icon';
import { AudioRecorder, describeMicrophoneError } from '../recorder/recorder';

const BAR_COUNT = 16;
/** Samples move at most this often, so the bars glide instead of twitching. */
const SAMPLE_INTERVAL_MS = 90;
const IDLE_WIDTH = 52;
/** How long "Done" stays before the pill settles back into the idle capsule. */
const DONE_HOLD_MS = 220 + 900;
const EXIT_MS = 260;
const LABEL_FADE_MS = 160;

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

/** The microphone level, eased: quick to rise, slow to fall, sampled at a calm pace. */
function useWaveform(active: boolean): [number[], (level: number) => void] {
  const [bars, setBars] = useState<number[]>(() => new Array(BAR_COUNT).fill(0));
  const level = useRef(0);
  const target = useRef(0);

  useEffect(() => {
    if (!active) {
      level.current = 0;
      target.current = 0;
      setBars(new Array(BAR_COUNT).fill(0));
      return;
    }
    const timer = setInterval(() => {
      const x = target.current;
      const previous = level.current;
      level.current = previous + (x - previous) * (x > previous ? 0.55 : 0.18);
      setBars((current) => [...current.slice(1), level.current]);
    }, SAMPLE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [active]);

  return [bars, (value: number) => (target.current = value)];
}

/** Swaps text with a short fade instead of a hard cut. */
function useCrossfade(text: string): [string, boolean] {
  const [shown, setShown] = useState(text);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    if (text === shown) return;
    setFading(true);
    const timer = setTimeout(() => {
      setShown(text);
      setFading(false);
    }, LABEL_FADE_MS);
    return () => clearTimeout(timer);
  }, [text, shown]);

  return [shown, fading];
}

type View = 'idle' | 'listening' | 'processing' | 'done' | 'error';

function viewFor(status: AppStatus): View {
  switch (status.phase) {
    case 'listening':
      return 'listening';
    case 'transcribing':
    case 'rewriting':
    case 'pasting':
      return 'processing';
    case 'done':
      return 'done';
    case 'error':
      return 'error';
    default:
      return 'idle';
  }
}

function labelFor(status: AppStatus, view: View): string {
  switch (view) {
    case 'listening':
      return status.handsfree ? 'Hands-free · tap to finish' : 'Listening';
    case 'processing':
      // One label for transcribing, polishing and pasting: at well under a
      // second in total, three would only flicker.
      return 'Transcribing';
    case 'done': {
      const word = status.title === 'Pasted' ? 'Done' : status.title.replace(/ instead$/, '');
      return status.metrics ? `${word} · ${(status.metrics.totalMs / 1000).toFixed(2)} s` : word;
    }
    case 'error':
      return status.title;
    default:
      return '';
  }
}

export function Overlay() {
  const [status, setStatus] = useState<AppStatus>({ phase: 'idle', title: '', detail: '' });
  const [settled, setSettled] = useState(false);
  const [exiting, setExiting] = useState(false);
  const measure = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(IDLE_WIDTH);

  useEffect(() => window.yap.onStatus(setStatus), []);

  const statusView = viewFor(status);
  // A finished dictation shows its result briefly, then settles back.
  const view: View = statusView === 'done' && settled ? 'idle' : statusView;
  const [bars, pushLevel] = useWaveform(view === 'listening');
  useRecorderHost(pushLevel);

  useEffect(() => {
    setSettled(false);
    setExiting(false);
    if (statusView !== 'done') return;
    const exit = setTimeout(() => setExiting(true), DONE_HOLD_MS);
    const settle = setTimeout(() => {
      setSettled(true);
      setExiting(false);
    }, DONE_HOLD_MS + EXIT_MS);
    return () => {
      clearTimeout(exit);
      clearTimeout(settle);
    };
  }, [status, statusView]);

  const label = labelFor(status, view);
  const [shownLabel, fading] = useCrossfade(label);
  const open = view !== 'idle' && !exiting;

  // The width follows the content, so every language fits and the change animates.
  useLayoutEffect(() => {
    if (!open) {
      setWidth(IDLE_WIDTH);
      return;
    }
    // Plus the pill's 1 px border on each side.
    const next = Math.ceil(measure.current?.scrollWidth ?? IDLE_WIDTH) + 2;
    setWidth(Math.max(IDLE_WIDTH, next));
  }, [open, view, label, status.handsfree]);

  const processing = view === 'processing';
  const body = (
    <>
      {view === 'listening' && <span className="pill-rec" />}
      {(view === 'listening' || processing) && (
        <div className={`wave${processing ? ' wave-processing' : ''}`}>
          {bars.map((value, index) => (
            <span
              key={index}
              style={processing ? { animationDelay: `${index * 90}ms` } : { transform: `scaleY(${0.12 + Math.min(1, value) * 0.88})` }}
            />
          ))}
        </div>
      )}
      {view === 'done' && <Icon name="check" size={15} strokeWidth={2.75} className="pill-check" />}
      {view === 'error' && <Icon name="alert" size={15} className="pill-icon-error" />}
    </>
  );

  return (
    <div className="overlay">
      <div className={`pill${open ? ' pill-open' : ''}${exiting ? ' pill-exiting' : ''}`} style={{ width }}>
        <span className="pill-dots" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((dot) => (
            <span key={dot} />
          ))}
        </span>
        <div className="pill-body">
          {body}
          <span className={`pill-label${fading ? ' pill-label-fading' : ''}`} role="status" aria-live="polite">
            {shownLabel}
          </span>
        </div>
      </div>
      {/* Invisible copy with the final label, measured for the pill's width. */}
      <div ref={measure} className="pill-body pill-measure" aria-hidden="true">
        {body}
        <span className="pill-label">{label}</span>
      </div>
    </div>
  );
}
