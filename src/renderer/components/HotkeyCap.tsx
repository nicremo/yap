import { useEffect, useState } from 'react';

import type { AppState } from '../../shared/types';
import { KeyCap } from './ui';

/** The dictation key as a keycap that presses down while the real key is held. */
export function HotkeyCap({ state, large }: { state: AppState; large?: boolean }) {
  const [pressed, setPressed] = useState(false);
  useEffect(() => window.yap.onHotkeyActivity(setPressed), []);
  return (
    <KeyCap large={large} pressed={pressed}>
      {state.settings.hotkey.label}
    </KeyCap>
  );
}
