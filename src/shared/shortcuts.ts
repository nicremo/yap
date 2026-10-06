import type { Messages } from './i18n';

/*
 * Global shortcuts as Electron accelerators, e.g. "Control+Alt+Shift+Command+6".
 * Settings store the accelerator; labels are made from it when shown, in the
 * language and keyboard layout of the moment.
 */

/** A modifier as Electron's accelerators name it. Super is the Windows key. */
export type ShortcutModifier = 'Control' | 'Alt' | 'Shift' | 'Command' | 'Super';

export interface Shortcut {
  /** In display order, the one macOS uses: ⌃ ⌥ ⇧ ⌘. */
  modifiers: ShortcutModifier[];
  /** The accelerator name of the key, e.g. "6", "K", "F5", "Space". */
  key: string;
}

const MODIFIER_ORDER: readonly ShortcutModifier[] = ['Control', 'Alt', 'Shift', 'Command', 'Super'];
const MAC_SYMBOLS: Record<ShortcutModifier, string> = { Control: '⌃', Alt: '⌥', Shift: '⇧', Command: '⌘', Super: '⌘' };

/** Keys that can finish a shortcut, by KeyboardEvent.code. Modifiers, Escape and fn cannot. */
const KEY_BY_CODE: Record<string, string> = {
  Space: 'Space',
  Tab: 'Tab',
  Enter: 'Enter',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backquote: '`',
};
for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') KEY_BY_CODE[`Key${letter}`] = letter;
for (const digit of '0123456789') KEY_BY_CODE[`Digit${digit}`] = digit;
for (let index = 1; index <= 24; index += 1) KEY_BY_CODE[`F${index}`] = `F${index}`;

const CODE_BY_KEY: Record<string, string> = Object.fromEntries(Object.entries(KEY_BY_CODE).map(([code, key]) => [key, code]));

const FUNCTION_KEY = /^F([1-9]|1\d|2[0-4])$/;

export function toAccelerator(shortcut: Shortcut): string {
  return [...shortcut.modifiers, shortcut.key].join('+');
}

/** Reads a stored accelerator. Null for anything Yap would not have written itself. */
export function parseAccelerator(accelerator: string): Shortcut | null {
  const parts = accelerator.split('+');
  const key = parts.pop();
  if (!key || !(key in CODE_BY_KEY)) return null;
  const modifiers = parts as ShortcutModifier[];
  const ordered = MODIFIER_ORDER.filter((modifier) => modifiers.includes(modifier));
  if (ordered.length !== modifiers.length || ordered.some((modifier, index) => modifier !== modifiers[index])) return null;
  return { modifiers: ordered, key };
}

/**
 * A global shortcut takes its keys away from every other app, so it needs
 * room: two modifiers, one of them Control or Command (Windows key), unless
 * it is a function key. Option and Shift alone would swallow characters
 * people type, like @ on a German Mac.
 */
export function shortcutIsRoomy(shortcut: Shortcut): boolean {
  if (FUNCTION_KEY.test(shortcut.key)) return true;
  const strong = shortcut.modifiers.some((modifier) => modifier === 'Control' || modifier === 'Command' || modifier === 'Super');
  return strong && shortcut.modifiers.length >= 2;
}

export function isValidAccelerator(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const shortcut = parseAccelerator(value);
  return shortcut !== null && shortcutIsRoomy(shortcut);
}

export interface ShortcutKeyEvent {
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

/** The modifiers held during a key event, in display order. */
export function modifiersOf(event: Omit<ShortcutKeyEvent, 'code'>, mac: boolean): ShortcutModifier[] {
  const pressed: Record<ShortcutModifier, boolean> = {
    Control: event.ctrlKey,
    Alt: event.altKey,
    Shift: event.shiftKey,
    Command: mac && event.metaKey,
    Super: !mac && event.metaKey,
  };
  return MODIFIER_ORDER.filter((modifier) => pressed[modifier]);
}

/**
 * The shortcut a key press means, or null while only modifiers are down.
 * macOS registers keys by position, so the physical key decides there.
 * Windows registers them by character, so letters follow the layout.
 */
export function shortcutFromKeyEvent(event: ShortcutKeyEvent, mac: boolean, layoutKey?: string): Shortcut | null {
  let key = KEY_BY_CODE[event.code];
  if (!key) return null;
  if (!mac && /^Key[A-Z]$/.test(event.code) && layoutKey && /^[a-z]$/i.test(layoutKey)) {
    key = layoutKey.toUpperCase();
  }
  return { modifiers: modifiersOf(event, mac), key };
}

/** What the layout prints on a key, e.g. "Y" for KeyZ on a German keyboard. */
export type KeyboardLayout = (code: string) => string | undefined;

function keyLabel(key: string, mac: boolean, names: Messages['keys'], layout?: KeyboardLayout): string {
  switch (key) {
    case 'Space':
      return names.space;
    case 'Enter':
      return mac ? '↩' : 'Enter';
    case 'Tab':
      return mac ? '⇥' : 'Tab';
    case 'Backspace':
      return mac ? '⌫' : 'Backspace';
    case 'Delete':
      return mac ? '⌦' : 'Del';
    case 'Up':
      return '↑';
    case 'Down':
      return '↓';
    case 'Left':
      return '←';
    case 'Right':
      return '→';
    default:
      break;
  }
  if (FUNCTION_KEY.test(key) || /^[0-9]$/.test(key) || key.length > 1) return key;
  // Letters and punctuation as printed on the user's keyboard. On Windows the
  // letter already is the layout's.
  const printed = mac || !/^[A-Z]$/.test(key) ? layout?.(CODE_BY_KEY[key]) : undefined;
  const label = printed && printed.trim() ? printed : key;
  // Keycaps show capitals, but ß would turn into SS.
  const upper = label.toUpperCase();
  return upper.length === label.length ? upper : label;
}

/** ⌃⌥⇧⌘6 on a Mac, Ctrl+Alt+Shift+6 elsewhere. An empty key shows the modifiers alone. */
export function shortcutLabel(shortcut: Shortcut, mac: boolean, names: Messages['keys'], layout?: KeyboardLayout): string {
  const key = shortcut.key ? keyLabel(shortcut.key, mac, names, layout) : '';
  if (mac) return shortcut.modifiers.map((modifier) => MAC_SYMBOLS[modifier]).join('') + key;
  const pc: Record<ShortcutModifier, string> = {
    Control: names.ctrl,
    Alt: names.alt,
    Shift: names.shift,
    Command: names.win,
    Super: names.win,
  };
  return [...shortcut.modifiers.map((modifier) => pc[modifier]), key].filter(Boolean).join('+');
}
