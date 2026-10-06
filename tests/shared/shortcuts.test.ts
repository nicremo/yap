import { describe, expect, it } from 'vitest';

import { MESSAGES } from '../../src/shared/i18n';
import {
  isValidAccelerator,
  parseAccelerator,
  shortcutFromKeyEvent,
  shortcutIsRoomy,
  shortcutLabel,
  toAccelerator,
} from '../../src/shared/shortcuts';

const press = (code: string, modifiers: Partial<Record<'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey', boolean>> = {}) => ({
  code,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...modifiers,
});

const all = { ctrlKey: true, altKey: true, shiftKey: true, metaKey: true };

describe('shortcutFromKeyEvent', () => {
  it('takes all four modifiers and a key, in the order macOS shows them', () => {
    const shortcut = shortcutFromKeyEvent(press('Digit6', all), true);
    expect(shortcut).toEqual({ modifiers: ['Control', 'Alt', 'Shift', 'Command'], key: '6' });
    expect(toAccelerator(shortcut!)).toBe('Control+Alt+Shift+Command+6');
  });

  it('waits while only modifiers are down', () => {
    expect(shortcutFromKeyEvent(press('ShiftLeft', { shiftKey: true }), true)).toBeNull();
    expect(shortcutFromKeyEvent(press('MetaRight', { metaKey: true }), true)).toBeNull();
  });

  it('uses the Windows key as Super off the Mac', () => {
    expect(toAccelerator(shortcutFromKeyEvent(press('KeyK', { ctrlKey: true, metaKey: true }), false)!)).toBe('Control+Super+K');
  });

  it('keeps the physical key on macOS and the printed letter on Windows', () => {
    // KeyZ is where a German keyboard has its Y.
    expect(shortcutFromKeyEvent(press('KeyZ', { ctrlKey: true, altKey: true }), true, 'y')?.key).toBe('Z');
    expect(shortcutFromKeyEvent(press('KeyZ', { ctrlKey: true, altKey: true }), false, 'y')?.key).toBe('Y');
  });
});

describe('shortcutIsRoomy', () => {
  it('asks for two modifiers, one of them Control or Command', () => {
    expect(shortcutIsRoomy({ modifiers: ['Command', 'Shift'], key: 'V' })).toBe(true);
    expect(shortcutIsRoomy({ modifiers: ['Control', 'Alt'], key: '6' })).toBe(true);
    expect(shortcutIsRoomy({ modifiers: ['Command'], key: 'C' })).toBe(false);
    expect(shortcutIsRoomy({ modifiers: ['Alt', 'Shift'], key: 'L' })).toBe(false);
    expect(shortcutIsRoomy({ modifiers: [], key: '6' })).toBe(false);
  });

  it('lets a function key stand alone', () => {
    expect(shortcutIsRoomy({ modifiers: [], key: 'F13' })).toBe(true);
  });
});

describe('stored accelerators', () => {
  it('round-trip', () => {
    const accelerator = 'Control+Alt+Shift+Command+6';
    expect(toAccelerator(parseAccelerator(accelerator)!)).toBe(accelerator);
    expect(isValidAccelerator(accelerator)).toBe(true);
  });

  it('reject anything Yap would not have written', () => {
    expect(isValidAccelerator('Alt+Control+6')).toBe(false);
    expect(isValidAccelerator('Control+Control+6')).toBe(false);
    expect(isValidAccelerator('Control+Alt+Escape')).toBe(false);
    expect(isValidAccelerator('Command+Q')).toBe(false);
    expect(isValidAccelerator('')).toBe(false);
    expect(isValidAccelerator(42)).toBe(false);
  });
});

describe('shortcutLabel', () => {
  it('uses symbols on a Mac and names elsewhere', () => {
    const shortcut = parseAccelerator('Control+Alt+Shift+Command+6')!;
    expect(shortcutLabel(shortcut, true, MESSAGES.en.keys)).toBe('⌃⌥⇧⌘6');
    expect(shortcutLabel(parseAccelerator('Control+Alt+Shift+Super+6')!, false, MESSAGES.en.keys)).toBe('Ctrl+Alt+Shift+Win+6');
    expect(shortcutLabel(parseAccelerator('Control+Alt+Shift+Super+6')!, false, MESSAGES.de.keys)).toBe('Strg+Alt+Umschalt+Win+6');
  });

  it('shows the letter printed on the key', () => {
    const layout = (code: string) => ({ KeyZ: 'y', Minus: 'ß' })[code];
    expect(shortcutLabel(parseAccelerator('Shift+Command+Z')!, true, MESSAGES.de.keys, layout)).toBe('⇧⌘Y');
    expect(shortcutLabel(parseAccelerator('Control+Alt+-')!, true, MESSAGES.de.keys, layout)).toBe('⌃⌥ß');
    expect(shortcutLabel(parseAccelerator('Control+Alt+Space')!, true, MESSAGES.de.keys)).toBe('⌃⌥Leertaste');
  });

  it('shows held modifiers while recording', () => {
    expect(shortcutLabel({ modifiers: ['Control', 'Shift'], key: '' }, false, MESSAGES.en.keys)).toBe('Ctrl+Shift');
    expect(shortcutLabel({ modifiers: ['Control', 'Shift'], key: '' }, true, MESSAGES.en.keys)).toBe('⌃⇧');
  });
});
