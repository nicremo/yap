import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { clipboard } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const helperReplies: string[] = [];

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => {
    const child = new EventEmitter() as EventEmitter & { stdout: PassThrough; stderr: PassThrough; kill: () => void };
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => undefined;
    queueMicrotask(() => {
      child.stdout.end(helperReplies.shift() ?? '{"ok":true}');
      child.stdout.on('end', () => child.emit('close', 0));
      child.stdout.resume();
    });
    return child;
  }),
}));

vi.mock('../../src/main/native/binary', () => ({
  ensureHelperBinary: async () => 'C:\\yap\\yap-helper.exe',
}));

const { WindowsHelperBridge, translateHotkey } = await import('../../src/main/native/windows');

describe('WindowsHelperBridge.paste', () => {
  let bridge: InstanceType<typeof WindowsHelperBridge>;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    helperReplies.length = 0;
    clipboard.writeText('what the user copied');
    bridge = new WindowsHelperBridge();
    await bridge.start();
  });

  afterEach(() => {
    bridge.dispose();
    vi.useRealTimers();
  });

  it('puts the previous clipboard back after a successful paste', async () => {
    helperReplies.push('{"ok":true}');
    const result = await bridge.paste({ text: 'dictated', restoreClipboard: true, selfEditable: false });
    expect(result).toEqual({ ok: true });
    expect(clipboard.readText()).toBe('dictated');

    vi.advanceTimersByTime(1_000);
    expect(clipboard.readText()).toBe('what the user copied');
  });

  it('leaves the text on the clipboard when pasting failed', async () => {
    helperReplies.push('{"ok":false}');
    const result = await bridge.paste({ text: 'dictated', restoreClipboard: true, selfEditable: false });
    expect(result).toEqual({ ok: false, reason: 'failed' });

    // The engine's fallback: the text must survive on the clipboard.
    clipboard.writeText('dictated');
    vi.advanceTimersByTime(1_000);
    expect(clipboard.readText()).toBe('dictated');
  });

  it('never names a window to bring forward', async () => {
    const { spawn } = await import('node:child_process');
    helperReplies.push('{"ok":true}');
    await bridge.paste({ text: 'dictated', restoreClipboard: true, selfEditable: false });
    expect(vi.mocked(spawn).mock.lastCall?.[1]).toEqual(['paste']);
  });

  it('keeps the text when asked to leave it on the clipboard', async () => {
    helperReplies.push('{"ok":true}');
    await bridge.paste({ text: 'dictated', restoreClipboard: false, selfEditable: false });
    vi.advanceTimersByTime(1_000);
    expect(clipboard.readText()).toBe('dictated');
  });

  it('restores the original once after two quick dictations', async () => {
    helperReplies.push('{"ok":true}', '{"ok":true}');
    await bridge.paste({ text: 'first', restoreClipboard: true, selfEditable: false });
    vi.advanceTimersByTime(300);
    await bridge.paste({ text: 'second', restoreClipboard: true, selfEditable: false });
    vi.advanceTimersByTime(1_000);
    expect(clipboard.readText()).toBe('what the user copied');
  });

  it('does not overwrite something the user copied in the meantime', async () => {
    helperReplies.push('{"ok":true}');
    await bridge.paste({ text: 'dictated', restoreClipboard: true, selfEditable: false });
    clipboard.writeText('copied right after');
    vi.advanceTimersByTime(1_000);
    expect(clipboard.readText()).toBe('copied right after');
  });
});

describe('translateHotkey', () => {
  it('maps macOS key codes and modifiers to the helper codes', () => {
    expect(translateHotkey({ keyCode: 61, modifiers: 0, label: 'Right Option' } as never)).toEqual({ keyCode: 4, modifiers: 0 });
    expect(translateHotkey({ keyCode: 49, modifiers: 0x100000 | 0x20000, label: 'Cmd+Shift+Space' } as never)).toEqual({ keyCode: 300, modifiers: 0x01 | 0x04 });
  });
});
