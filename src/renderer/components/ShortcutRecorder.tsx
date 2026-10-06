import { useEffect, useState } from 'react';

import {
  modifiersOf,
  parseAccelerator,
  shortcutFromKeyEvent,
  shortcutIsRoomy,
  shortcutLabel,
  toAccelerator,
  type KeyboardLayout,
} from '../../shared/shortcuts';
import type { AppState } from '../../shared/types';
import { useT } from '../lib/i18n';
import { Icon } from './Icon';
import { Notice } from './ui';

interface LayoutMap {
  get(code: string): string | undefined;
}

/** What the keyboard prints on each key, for labels. Chromium's Keyboard API; absent means US names. */
export function useKeyboardLayout(): KeyboardLayout | undefined {
  const [layout, setLayout] = useState<KeyboardLayout>();
  useEffect(() => {
    const keyboard = (navigator as Navigator & { keyboard?: { getLayoutMap(): Promise<LayoutMap> } }).keyboard;
    let alive = true;
    keyboard?.getLayoutMap().then(
      (map) => alive && setLayout(() => (code: string) => map.get(code)),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, []);
  return layout;
}

/** The copy-last shortcut as the UI shows it, or null when none is set. */
export function useCopyLastLabel(state: AppState): string | null {
  const t = useT();
  const layout = useKeyboardLayout();
  const shortcut = parseAccelerator(state.settings.copyLastShortcut);
  return shortcut ? shortcutLabel(shortcut, state.platform === 'darwin', t.keys, layout) : null;
}

/**
 * Records the shortcut that copies the last dictation: up to four modifiers
 * and one key, pressed together.
 */
export function CopyLastShortcut({ state, onSave }: { state: AppState; onSave: (accelerator: string) => void }) {
  const t = useT();
  const mac = state.platform === 'darwin';
  const layout = useKeyboardLayout();
  const [recording, setRecording] = useState(false);
  const [preview, setPreview] = useState('');
  const [tooTight, setTooTight] = useState(false);
  const current = parseAccelerator(state.settings.copyLastShortcut);

  const stop = () => {
    setRecording(false);
    setPreview('');
    setTooTight(false);
  };

  useEffect(() => {
    if (!recording) return;

    const showModifiers = (event: KeyboardEvent) =>
      setPreview(shortcutLabel({ modifiers: modifiersOf(event, mac), key: '' }, mac, t.keys, layout));

    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.code === 'Escape') {
        stop();
        return;
      }
      const shortcut = shortcutFromKeyEvent(event, mac, layout?.(event.code));
      if (!shortcut) {
        showModifiers(event);
        return;
      }
      if (!shortcutIsRoomy(shortcut)) {
        setPreview(shortcutLabel(shortcut, mac, t.keys, layout));
        setTooTight(true);
        return;
      }
      stop();
      onSave(toAccelerator(shortcut));
    };
    const onKeyUp = (event: KeyboardEvent) => {
      event.preventDefault();
      showModifiers(event);
    };

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
    };
  }, [recording, mac, layout, t, onSave]);

  const hint = !recording ? t.copyLast.hint : tooTight ? t.copyLast.needsModifiers(mac) : t.copyLast.recordingHint;

  return (
    <div className="shortcut-setting">
      <div className="row">
        <div className="row-text">
          <strong>{t.copyLast.title}</strong>
          <span className={tooTight ? 'row-text-problem' : undefined} role={recording ? 'status' : undefined}>
            {hint}
          </span>
        </div>
        <div className="shortcut-control">
          <button
            type="button"
            className={`hotkey-button${recording ? ' hotkey-button-recording' : ''}`}
            onClick={() => (recording ? stop() : setRecording(true))}
          >
            {recording ? preview || t.copyLast.recording : current ? shortcutLabel(current, mac, t.keys, layout) : t.copyLast.set}
          </button>
          {current && !recording && (
            <button type="button" className="icon-button" aria-label={t.copyLast.remove} title={t.copyLast.remove} onClick={() => onSave('')}>
              <Icon name="x" size={14} />
            </button>
          )}
        </div>
      </div>
      {state.copyLastShortcut === 'taken' && !recording && <Notice tone="warning">{t.copyLast.taken}</Notice>}
    </div>
  );
}
