import type { HotkeyConfig } from './types';

export const MODIFIER_FLAGS = {
  command: 0x100000,
  option: 0x80000,
  shift: 0x20000,
  control: 0x40000,
} as const;

export const MODIFIER_LABELS: Record<string, string> = {
  command: '\u2318',
  option: '\u2325',
  shift: '\u21E7',
  control: '\u2303',
};

export const KEY_LABELS: Record<number, string> = {
  // Modifier-only keys (right-side variants)
  54: 'Right \u2318',
  61: 'Right \u2325',
  60: 'Right \u21E7',
  62: 'Right \u2303',
  // Modifier-only keys (left-side variants)
  55: 'Left \u2318',
  58: 'Left \u2325',
  56: 'Left \u21E7',
  59: 'Left \u2303',
  // Function keys
  63: 'Fn',
  122: 'F1',
  120: 'F2',
  99: 'F3',
  118: 'F4',
  96: 'F5',
  97: 'F6',
  98: 'F7',
  100: 'F8',
  101: 'F9',
  109: 'F10',
  103: 'F11',
  111: 'F12',
  105: 'F13',
  107: 'F14',
  113: 'F15',
  // Common keys
  36: 'Return',
  48: 'Tab',
  49: 'Space',
  51: 'Delete',
  53: 'Escape',
  // Letters (a-z)
  0: 'A', 11: 'B', 8: 'C', 2: 'D', 14: 'E', 3: 'F', 5: 'G', 4: 'H',
  34: 'I', 38: 'J', 40: 'K', 37: 'L', 46: 'M', 45: 'N', 31: 'O',
  35: 'P', 12: 'Q', 15: 'R', 1: 'S', 17: 'T', 32: 'U', 9: 'V',
  13: 'W', 7: 'X', 16: 'Y', 6: 'Z',
  // Numbers
  29: '0', 18: '1', 19: '2', 20: '3', 21: '4',
  23: '5', 22: '6', 26: '7', 28: '8', 25: '9',
};

export const MODIFIER_ONLY_KEYCODES = new Set([54, 55, 56, 58, 59, 60, 61, 62, 63]);

export function formatHotkeyLabel(config: HotkeyConfig): string {
  return config.label;
}

export function buildHotkeyLabel(keyCode: number, modifiers: number): string {
  const parts: string[] = [];

  if (modifiers & MODIFIER_FLAGS.control) parts.push(MODIFIER_LABELS.control);
  if (modifiers & MODIFIER_FLAGS.option) parts.push(MODIFIER_LABELS.option);
  if (modifiers & MODIFIER_FLAGS.shift) parts.push(MODIFIER_LABELS.shift);
  if (modifiers & MODIFIER_FLAGS.command) parts.push(MODIFIER_LABELS.command);

  if (!MODIFIER_ONLY_KEYCODES.has(keyCode)) {
    parts.push(KEY_LABELS[keyCode] ?? `Key ${keyCode}`);
  } else if (parts.length === 0) {
    parts.push(KEY_LABELS[keyCode] ?? `Key ${keyCode}`);
  }

  return parts.join('');
}

export const FN_KEY_CODE = 63;
export const FN_KEY_FLAG = 0x800000;

export const FN_HOTKEY: HotkeyConfig = {
  keyCode: FN_KEY_CODE,
  modifiers: 0,
  label: 'Fn',
};

export const RIGHT_ALT_HOTKEY: HotkeyConfig = {
  keyCode: 61,
  modifiers: 0,
  label: 'Right \u2325',
};

export const DEFAULT_HOTKEY: HotkeyConfig = FN_HOTKEY;
export const DEFAULT_HOTKEY_WINDOWS: HotkeyConfig = RIGHT_ALT_HOTKEY;
