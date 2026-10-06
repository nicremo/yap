import { useEffect, useState } from 'react';

import { hotkeyLabel } from '../../shared/hotkeys';
import type { AppState } from '../../shared/types';
import { useT } from '../lib/i18n';
import { KeyCap } from './ui';

/** The dictation key as a keycap that presses down while the real key is held. */
export function HotkeyCap({ state, large }: { state: AppState; large?: boolean }) {
  const t = useT();
  const [pressed, setPressed] = useState(false);
  useEffect(() => window.yap.onHotkeyActivity(setPressed), []);
  return (
    <KeyCap large={large} pressed={pressed}>
      {hotkeyLabel(state.settings.hotkey, t.keys)}
    </KeyCap>
  );
}
