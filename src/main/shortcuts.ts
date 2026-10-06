import { globalShortcut } from 'electron';

import type { ShortcutState } from '../shared/types';

let registered: string | null = null;

/**
 * Registers the shortcut that copies the last dictation, replacing the one
 * before. A system-wide shortcut through the OS hotkey API: it needs no
 * permission, and the keys never reach the app in front.
 */
export function applyCopyLastShortcut(accelerator: string, onPress: () => void): ShortcutState {
  if (registered) {
    globalShortcut.unregister(registered);
    registered = null;
  }
  if (!accelerator) return 'off';

  try {
    if (globalShortcut.register(accelerator, onPress)) {
      registered = accelerator;
      return 'active';
    }
  } catch (error) {
    console.warn('[yap] shortcut not registered:', accelerator, error instanceof Error ? error.message : error);
  }
  // Another app holds it, or the system reserves it.
  return 'taken';
}

export function releaseShortcuts(): void {
  registered = null;
  globalShortcut.unregisterAll();
}
