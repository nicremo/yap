import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import type { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

import { app } from 'electron';

import type { FocusInfo, HotkeyConfig, HotkeyEvent, PermissionsState } from '../shared/types';
import { pathExists } from './storage';

// Abstract key codes expected by the Windows helper (must match OpenWhispHelper.cpp)
const AK = {
  LEFT_META: 1, RIGHT_META: 2,
  LEFT_ALT: 3, RIGHT_ALT: 4,
  LEFT_SHIFT: 5, RIGHT_SHIFT: 6,
  LEFT_CTRL: 7, RIGHT_CTRL: 8,
  FN: 9,
  KEY_A: 100,
  DIGIT_0: 200,
  SPACE: 300, ENTER: 301, TAB: 302, BACKSPACE: 303, ESCAPE: 304,
  F1: 400,
} as const;

// macOS CGEvent key code to abstract key code mapping
const MAC_TO_ABSTRACT: Record<number, number> = {
  // Modifiers
  55: AK.LEFT_META, 54: AK.RIGHT_META,
  58: AK.LEFT_ALT, 61: AK.RIGHT_ALT,
  56: AK.LEFT_SHIFT, 60: AK.RIGHT_SHIFT,
  59: AK.LEFT_CTRL, 62: AK.RIGHT_CTRL,
  63: AK.FN,
  // Letters (CGEvent codes are non-sequential)
  0: AK.KEY_A, 11: AK.KEY_A + 1, 8: AK.KEY_A + 2, 2: AK.KEY_A + 3,
  14: AK.KEY_A + 4, 3: AK.KEY_A + 5, 5: AK.KEY_A + 6, 4: AK.KEY_A + 7,
  34: AK.KEY_A + 8, 38: AK.KEY_A + 9, 40: AK.KEY_A + 10, 37: AK.KEY_A + 11,
  46: AK.KEY_A + 12, 45: AK.KEY_A + 13, 31: AK.KEY_A + 14, 35: AK.KEY_A + 15,
  12: AK.KEY_A + 16, 15: AK.KEY_A + 17, 1: AK.KEY_A + 18, 17: AK.KEY_A + 19,
  32: AK.KEY_A + 20, 9: AK.KEY_A + 21, 13: AK.KEY_A + 22, 7: AK.KEY_A + 23,
  16: AK.KEY_A + 24, 6: AK.KEY_A + 25,
  // Digits
  29: AK.DIGIT_0, 18: AK.DIGIT_0 + 1, 19: AK.DIGIT_0 + 2, 20: AK.DIGIT_0 + 3,
  21: AK.DIGIT_0 + 4, 23: AK.DIGIT_0 + 5, 22: AK.DIGIT_0 + 6, 26: AK.DIGIT_0 + 7,
  28: AK.DIGIT_0 + 8, 25: AK.DIGIT_0 + 9,
  // Special keys
  49: AK.SPACE, 36: AK.ENTER, 48: AK.TAB, 51: AK.BACKSPACE, 53: AK.ESCAPE,
  // Function keys
  122: AK.F1, 120: AK.F1 + 1, 99: AK.F1 + 2, 118: AK.F1 + 3,
  96: AK.F1 + 4, 97: AK.F1 + 5, 98: AK.F1 + 6, 100: AK.F1 + 7,
  101: AK.F1 + 8, 109: AK.F1 + 9, 103: AK.F1 + 10, 111: AK.F1 + 11,
  105: AK.F1 + 12, 107: AK.F1 + 13, 113: AK.F1 + 14,
};

// macOS modifier flags to abstract modifier flags
const MAC_MOD = { command: 0x100000, option: 0x80000, shift: 0x20000, control: 0x40000 };
const ABS_MOD = { meta: 0x01, alt: 0x02, shift: 0x04, ctrl: 0x08 };

function translateModifiers(macModifiers: number): number {
  let result = 0;
  if (macModifiers & MAC_MOD.command) result |= ABS_MOD.meta;
  if (macModifiers & MAC_MOD.option) result |= ABS_MOD.alt;
  if (macModifiers & MAC_MOD.shift) result |= ABS_MOD.shift;
  if (macModifiers & MAC_MOD.control) result |= ABS_MOD.ctrl;
  return result;
}

function translateHotkey(hotkey: HotkeyConfig): { keyCode: number; modifiers: number } {
  return {
    keyCode: MAC_TO_ABSTRACT[hotkey.keyCode] ?? hotkey.keyCode,
    modifiers: translateModifiers(hotkey.modifiers),
  };
}

const projectRoot = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const isWindows = process.platform === 'win32';
const helperExt = isWindows ? '.exe' : '';
const helperSourcePath = isWindows
  ? path.join(projectRoot, 'windows', 'OpenWhispHelper.cpp')
  : path.join(projectRoot, 'swift', 'OpenWhispHelper.swift');

type ListenerProcess = ChildProcessByStdio<null, Readable, Readable>;

let listenerProcess: ListenerProcess | null = null;

function getHelperBinaryPath(): string {
  const name = `openwhisp-helper${helperExt}`;
  return app.isPackaged
    ? path.join(process.resourcesPath, 'native', name)
    : path.join(projectRoot, 'build', 'native', name);
}

async function compileHelper(): Promise<boolean> {
  if (app.isPackaged) {
    return pathExists(getHelperBinaryPath());
  }

  const outputPath = getHelperBinaryPath();
  const outputDirectory = path.dirname(outputPath);
  await mkdir(outputDirectory, { recursive: true });

  return new Promise<boolean>((resolve) => {
    const compileArgs = isWindows
      ? ['g++', ['-O2', '-o', outputPath, helperSourcePath, '-luser32', '-lkernel32']]
      : ['swiftc', [helperSourcePath, '-o', outputPath]];

    const child = spawn(compileArgs[0] as string, compileArgs[1] as string[], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
  });
}

export async function ensureNativeHelper(): Promise<boolean> {
  if (await pathExists(getHelperBinaryPath())) {
    return true;
  }

  if (!(await pathExists(helperSourcePath))) {
    return false;
  }

  return compileHelper();
}

async function runHelperJson<T>(args: string[]): Promise<T> {
  const helperReady = await ensureNativeHelper();
  if (!helperReady) {
    throw new Error('The native OpenWhisp helper is not available.');
  }

  return new Promise<T>((resolve, reject) => {
    const child = spawn(getHelperBinaryPath(), args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || 'The helper exited unexpectedly.'));
        return;
      }

      try {
        resolve(JSON.parse(stdout.trim()) as T);
      } catch (error) {
        reject(error);
      }
    });
  });
}

export async function getNativePermissionState(): Promise<PermissionsState> {
  try {
    return await runHelperJson<PermissionsState>(['permissions', 'status']);
  } catch {
    return {
      accessibility: false,
      inputMonitoring: false,
      postEvents: false,
      microphone: 'unknown',
    };
  }
}

export async function requestNativePermissions(): Promise<PermissionsState> {
  try {
    return await runHelperJson<PermissionsState>(['permissions', 'request']);
  } catch {
    return getNativePermissionState();
  }
}

export async function getFocusInfo(): Promise<FocusInfo> {
  return runHelperJson<FocusInfo>(['focus']);
}

export async function triggerPaste(targetFocus?: FocusInfo): Promise<boolean> {
  const args = ['paste'];

  if (targetFocus?.bundleIdentifier || typeof targetFocus?.processIdentifier === 'number') {
    args.push(targetFocus.bundleIdentifier ?? '');
    args.push(String(targetFocus.processIdentifier ?? ''));
  }

  const result = await runHelperJson<{ ok: boolean }>(args);
  return result.ok;
}

export async function startFnListener(
  onEvent: (event: HotkeyEvent) => void,
  onError?: (message: string) => void,
  hotkey?: HotkeyConfig,
): Promise<boolean> {
  const helperReady = await ensureNativeHelper();
  if (!helperReady || listenerProcess) {
    return helperReady;
  }

  const args = ['listen'];
  if (hotkey) {
    const resolved = isWindows ? translateHotkey(hotkey) : hotkey;
    args.push(String(resolved.keyCode), String(resolved.modifiers));
  }

  const child = spawn(getHelperBinaryPath(), args, {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  listenerProcess = child;
  const stdoutInterface = readline.createInterface({ input: child.stdout });

  stdoutInterface.on('line', (line) => {
    if (!line.trim()) {
      return;
    }

    try {
      const message = JSON.parse(line) as { type?: string; message?: string };

      if (message.type === 'fnDown') {
        onEvent({ type: 'down' });
      }

      if (message.type === 'fnUp') {
        onEvent({ type: 'up' });
      }

      if (message.type === 'error') {
        onError?.(message.message ?? 'The native helper could not watch the Fn key.');
      }
    } catch {
      // Ignore malformed lines from the native helper.
    }
  });

  child.stderr.on('data', (chunk) => {
    const message = chunk.toString().trim();
    if (message) {
      onError?.(message);
    }
  });

  child.on('close', () => {
    stdoutInterface.close();
    listenerProcess = null;
  });

  return true;
}

export function isFnListenerRunning(): boolean {
  return listenerProcess !== null;
}

export function stopFnListener(): void {
  listenerProcess?.kill();
  listenerProcess = null;
}
