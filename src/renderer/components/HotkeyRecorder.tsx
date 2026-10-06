import { useEffect, useRef, useState } from 'react';

import type { AppState, HotkeyConfig } from '../../shared/types';
import {
  buildHotkeyLabel,
  FN_HOTKEY,
  FN_KEY_CODE,
  hotkeyLabel,
  MODIFIER_FLAGS,
  MODIFIER_ONLY_KEYCODES,
  RIGHT_ALT_HOTKEY,
} from '../../shared/hotkeys';
import { rich, useT } from '../lib/i18n';
import { Button, KeyCap, Notice, ToggleRow } from './ui';

const DOM_TO_MAC: Record<string, number> = {
  MetaLeft: 55, MetaRight: 54,
  AltLeft: 58, AltRight: 61,
  ShiftLeft: 56, ShiftRight: 60,
  ControlLeft: 59, ControlRight: 62,
  Space: 49, Enter: 36, Tab: 48, Backspace: 51, Escape: 53,
  KeyA: 0, KeyB: 11, KeyC: 8, KeyD: 2, KeyE: 14, KeyF: 3,
  KeyG: 5, KeyH: 4, KeyI: 34, KeyJ: 38, KeyK: 40, KeyL: 37,
  KeyM: 46, KeyN: 45, KeyO: 31, KeyP: 35, KeyQ: 12, KeyR: 15,
  KeyS: 1, KeyT: 17, KeyU: 32, KeyV: 9, KeyW: 13, KeyX: 7,
  KeyY: 16, KeyZ: 6,
  Digit0: 29, Digit1: 18, Digit2: 19, Digit3: 20, Digit4: 21,
  Digit5: 23, Digit6: 22, Digit7: 26, Digit8: 28, Digit9: 25,
  F1: 122, F2: 120, F3: 99, F4: 118, F5: 96, F6: 97,
  F7: 98, F8: 100, F9: 101, F10: 109, F11: 103, F12: 111,
  F13: 105, F14: 107, F15: 113,
};

function modifierFlagForKeyCode(keyCode: number): number {
  switch (keyCode) {
    case 54:
    case 55:
      return MODIFIER_FLAGS.command;
    case 58:
    case 61:
      return MODIFIER_FLAGS.option;
    case 56:
    case 60:
      return MODIFIER_FLAGS.shift;
    case 59:
    case 62:
      return MODIFIER_FLAGS.control;
    default:
      return 0;
  }
}

function HotkeyCapture({ current, onSave }: { current: HotkeyConfig; onSave: (config: HotkeyConfig) => void }) {
  const t = useT();
  const [recording, setRecording] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const pending = useRef<{ keyCode: number; modifiers: number } | null>(null);

  useEffect(() => {
    if (!recording) return;

    const finish = (config: { keyCode: number; modifiers: number }) => {
      onSave({ ...config, label: buildHotkeyLabel(config.keyCode, config.modifiers) });
      setRecording(false);
      setPreview(null);
      pending.current = null;
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();

      if (event.code === 'Escape') {
        setRecording(false);
        setPreview(null);
        pending.current = null;
        return;
      }

      let modifiers = 0;
      if (event.metaKey) modifiers |= MODIFIER_FLAGS.command;
      if (event.altKey) modifiers |= MODIFIER_FLAGS.option;
      if (event.shiftKey) modifiers |= MODIFIER_FLAGS.shift;
      if (event.ctrlKey) modifiers |= MODIFIER_FLAGS.control;

      const keyCode = DOM_TO_MAC[event.code];
      if (keyCode === undefined) return;

      if (MODIFIER_ONLY_KEYCODES.has(keyCode)) {
        // A modifier on its own is decided on release, so combos stay possible.
        pending.current = { keyCode, modifiers: modifiers & ~modifierFlagForKeyCode(keyCode) };
        setPreview(buildHotkeyLabel(keyCode, pending.current.modifiers, t.keys));
        return;
      }

      finish({ keyCode, modifiers });
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (pending.current) finish(pending.current);
    };

    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('keyup', handleKeyUp, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('keyup', handleKeyUp, true);
    };
  }, [recording, onSave, t]);

  return (
    <div className="hotkey-capture">
      <div className="row">
        <div className="row-text">
          <strong>{t.hotkey.dictationKey}</strong>
          <span>{recording ? t.hotkey.recordingHint : t.hotkey.idleHint}</span>
        </div>
        <button
          type="button"
          className={`hotkey-button${recording ? ' hotkey-button-recording' : ''}`}
          onClick={() => {
            setRecording((value) => !value);
            setPreview(null);
            pending.current = null;
          }}
        >
          {recording ? preview ?? t.hotkey.pressKey : hotkeyLabel(current, t.keys)}
        </button>
      </div>
    </div>
  );
}

export function FnKeyNotice({ state }: { state: AppState }) {
  const t = useT();
  const usesFn = state.settings.hotkey.keyCode === FN_KEY_CODE && state.settings.hotkey.modifiers === 0;
  if (!usesFn || !state.fnKeyAction || state.fnKeyAction === 'nothing' || state.fnKeyAction === 'unknown') {
    return null;
  }

  return (
    <Notice
      tone="warning"
      action={
        <Button size="sm" onClick={() => void window.yap.openKeyboardSettings()}>
          {t.hotkey.keyboardSettings}
        </Button>
      }
    >
      {rich(t.hotkey.fnNotice, {
        fn: <KeyCap>fn</KeyCap>,
        action: t.hotkey.fnActions[state.fnKeyAction],
        setting: <em>{t.hotkey.fnSetting}</em>,
        value: <em>{t.hotkey.fnValue}</em>,
      })}
    </Notice>
  );
}

export function HotkeySettings({ state, onSave }: { state: AppState; onSave: (config: HotkeyConfig) => void }) {
  const t = useT();
  const hotkey = state.settings.hotkey;
  const isFn = hotkey.keyCode === FN_KEY_CODE && hotkey.modifiers === 0;
  const isMac = state.platform === 'darwin';

  return (
    <div className="hotkey-settings">
      {isMac && (
        <ToggleRow
          title={t.hotkey.useFn}
          description={t.hotkey.useFnHint}
          checked={isFn}
          onChange={(value) => onSave(value ? FN_HOTKEY : RIGHT_ALT_HOTKEY)}
        />
      )}
      {(!isMac || !isFn) && <HotkeyCapture current={hotkey} onSave={onSave} />}
      {isMac && <FnKeyNotice state={state} />}
    </div>
  );
}
