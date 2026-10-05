import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { WebContents } from 'electron';

import type { AppSettings, AppStatus, PermissionsState, RecorderCommand } from '../../src/shared/types';

const pipeline = vi.hoisted(() => ({
  transcribe: vi.fn(),
  polish: vi.fn(),
}));
const keyState = vi.hoisted(() => ({ set: true }));

vi.mock('../../src/main/dictation/pipeline', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/main/dictation/pipeline')>()),
  transcribe: pipeline.transcribe,
  polish: pipeline.polish,
}));
vi.mock('../../src/main/app-rules', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/main/app-rules')>()),
  loadAppRules: async () => [],
}));
vi.mock('../../src/main/dictionary', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/main/dictionary')>()),
  loadDictionary: async () => [],
  loadCorrections: async () => [],
}));
vi.mock('../../src/main/audio-store', () => ({
  writeAudioRecording: async (_settings: unknown, id: string) => ({ filename: `${id}.wav`, absolutePath: `/tmp/${id}.wav` }),
  readAudioRecording: async () => Buffer.alloc(0),
  deleteAudioRecording: async () => undefined,
  computeAudioExpiresAt: (iso: string) => iso,
}));
vi.mock('../../src/main/history', () => {
  let entries: Array<{ id: string }> = [];
  return {
    loadHistory: async () => entries,
    addHistoryEntry: async (input: { id: string }) => {
      entries = [input, ...entries];
      return { entry: input, entries };
    },
    updateHistoryEntry: async (id: string, patch: object) => {
      entries = entries.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry));
      return { entry: entries.find((entry) => entry.id === id) ?? null, entries };
    },
    removeHistoryEntry: async (id: string) => {
      entries = entries.filter((entry) => entry.id !== id);
      return entries;
    },
  };
});
vi.mock('../../src/main/groq', () => ({ prewarmGroq: vi.fn() }));
vi.mock('../../src/main/secrets', () => ({ isGroqKeySet: () => keyState.set }));

import { clipboard } from 'electron';

import { DictationEngine } from '../../src/main/dictation/engine';
import { createDefaultSettings } from '../../src/main/defaults';
import type { NativeBridge } from '../../src/main/native';

const permissions: PermissionsState = {
  microphone: 'granted',
  accessibility: true,
  inputMonitoring: true,
  hotkeyActive: true,
  hotkeyError: null,
  nativePermissionsRequired: true,
};

let now = 0;
let settings: AppSettings;
let commands: RecorderCommand[];
let statuses: AppStatus[];
let pasted: Array<{ text: string; restoreClipboard: boolean }>;
let pasteResult: { ok: boolean; reason?: 'accessibility' };
let peakRms: number;
let showMainWindow: Mock<() => void>;
let prepareClipboard: Mock<() => void>;
let engine: DictationEngine;

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/* Date.now is mocked, so the deadline is measured with performance.now. */
async function waitFor(check: () => boolean, timeoutMs = 1_000): Promise<void> {
  const begin = performance.now();
  while (!check()) {
    if (performance.now() - begin > timeoutMs) throw new Error('condition not met');
    await flush();
  }
}

async function hold(ms: number): Promise<void> {
  engine.handleHotkey({ type: 'down', focus: { appName: 'Notes', bundleIdentifier: 'com.apple.Notes', processIdentifier: 42 } });
  await flush();
  now += ms;
  engine.handleHotkey({ type: 'up' });
  await flush();
}

beforeEach(() => {
  now = 1_000_000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  settings = { ...createDefaultSettings(), groqApiKeyEncrypted: 'cipher' };
  commands = [];
  statuses = [];
  pasted = [];
  pasteResult = { ok: true };
  peakRms = 0.2;
  keyState.set = true;
  clipboard.writeText('previous clipboard');
  showMainWindow = vi.fn();
  prepareClipboard = vi.fn();

  pipeline.transcribe.mockReset().mockResolvedValue({ text: 'hallo welt', source: 'cloud', uploadBytes: 1200 });
  pipeline.polish.mockReset().mockImplementation(async ({ text }: { text: string }) => ({ text: `${text}!`, durationMs: 5 }));

  const recorder = {
    send: (_channel: string, command: RecorderCommand) => {
      commands.push(command);
      if (command.type === 'stop') {
        setTimeout(() =>
          engine.handleRecordedAudio({
            sessionId: command.sessionId,
            wav: new ArrayBuffer(64),
            opus: new ArrayBuffer(8),
            durationMs: 1_500,
            peakRms,
          }),
        );
      }
    },
  } as unknown as WebContents;

  const bridge = {
    prepareClipboard,
    getFocus: async () => null,
    paste: async (request: { text: string; restoreClipboard: boolean }) => {
      pasted.push({ text: request.text, restoreClipboard: request.restoreClipboard });
      return pasteResult;
    },
  } as unknown as NativeBridge;

  engine = new DictationEngine(
    {
      getSettings: () => settings,
      getPermissions: () => permissions,
      requestMicrophone: () => undefined,
      isLocalModelReady: () => true,
      getRecorder: async () => recorder,
      setStatus: (status) => statuses.push(status),
      broadcastHistory: () => undefined,
      showMainWindow,
      notifyHotkey: () => undefined,
    },
    bridge,
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DictationEngine', () => {
  it('opens the microphone on the first press and asks for Opus in cloud mode', async () => {
    engine.handleHotkey({ type: 'down' });
    await flush();
    expect(commands).toEqual([{ type: 'start', sessionId: 1, encodeOpus: true }]);
    expect(statuses.at(-1)?.phase).toBe('listening');
  });

  it('pastes the polished text and restores the clipboard when copying is off', async () => {
    await hold(1_200);
    await waitFor(() => pasted.length === 1);

    expect(commands.map((command) => command.type)).toEqual(['start', 'stop']);
    expect(prepareClipboard).toHaveBeenCalledTimes(1);
    expect(pasted).toEqual([{ text: 'hallo welt!', restoreClipboard: true }]);
    expect(clipboard.readText()).toBe('previous clipboard');
    await waitFor(() => statuses.at(-1)?.phase === 'done');
    expect(statuses.at(-1)?.title).toBe('Pasted');
  });

  it('leaves the text on the clipboard when copying is on', async () => {
    settings = { ...settings, copyToClipboard: true };
    await hold(1_200);
    await waitFor(() => pasted.length === 1);

    expect(prepareClipboard).not.toHaveBeenCalled();
    expect(pasted[0].restoreClipboard).toBe(false);
  });

  it('only copies when pasting is off and copying is on', async () => {
    settings = { ...settings, autoPaste: false, copyToClipboard: true };
    await hold(1_200);
    await waitFor(() => statuses.at(-1)?.phase === 'done');

    expect(pasted).toHaveLength(0);
    expect(clipboard.readText()).toBe('hallo welt!');
  });

  it('touches neither paste nor clipboard when both are off', async () => {
    settings = { ...settings, autoPaste: false, copyToClipboard: false };
    await hold(1_200);
    await waitFor(() => statuses.at(-1)?.phase === 'done');

    expect(pasted).toHaveLength(0);
    expect(clipboard.readText()).toBe('previous clipboard');
    expect(statuses.at(-1)?.title).toBe('Saved');
  });

  it('copies instead when Accessibility blocks the paste', async () => {
    pasteResult = { ok: false, reason: 'accessibility' };
    await hold(1_200);
    await waitFor(() => statuses.at(-1)?.phase === 'done');

    expect(clipboard.readText()).toBe('hallo welt!');
    expect(statuses.at(-1)?.title).toBe('Copied instead');
  });

  it('pastes in speaking order even when the second result is ready first', async () => {
    let releaseFirst!: () => void;
    pipeline.transcribe
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseFirst = () => resolve({ text: 'erster', source: 'cloud', uploadBytes: 1 });
          }),
      )
      .mockImplementationOnce(async () => ({ text: 'zweiter', source: 'cloud', uploadBytes: 1 }));

    await hold(1_200);
    await waitFor(() => pipeline.transcribe.mock.calls.length === 1);
    now += 5_000;
    await hold(1_200);
    await waitFor(() => pipeline.transcribe.mock.calls.length === 2);
    await flush();
    expect(pasted).toHaveLength(0);

    releaseFirst();
    await waitFor(() => pasted.length === 2);
    expect(pasted.map((entry) => entry.text)).toEqual(['erster!', 'zweiter!']);
  });

  it('skips silent recordings without calling Groq', async () => {
    peakRms = 0.001;
    await hold(1_200);
    await waitFor(() => statuses.at(-1)?.phase === 'error');

    expect(pipeline.transcribe).not.toHaveBeenCalled();
    expect(statuses.at(-1)?.title).toBe('Nothing heard');
    expect(pasted).toHaveLength(0);
  });

  it('drops a Whisper hallucination on a quiet recording', async () => {
    peakRms = 0.01;
    pipeline.transcribe.mockResolvedValueOnce({ text: 'Untertitel im Auftrag des ZDF, 2017', source: 'cloud', uploadBytes: 1 });
    await hold(1_200);
    await waitFor(() => statuses.at(-1)?.phase === 'error');

    expect(statuses.at(-1)?.title).toBe('Nothing heard');
    expect(pasted).toHaveLength(0);
  });

  it('cancels a single accidental tap', async () => {
    await hold(60);
    await new Promise((resolve) => setTimeout(resolve, 450));

    expect(commands.map((command) => command.type)).toEqual(['start', 'cancel']);
    expect(pipeline.transcribe).not.toHaveBeenCalled();
  });

  it('does not start and opens the app when the Groq key is missing', async () => {
    keyState.set = false;
    engine.handleHotkey({ type: 'down' });
    await flush();

    expect(commands).toHaveLength(0);
    expect(showMainWindow).toHaveBeenCalled();
    expect(statuses.at(-1)?.title).toBe('Groq key missing');
  });

  it('reports a microphone failure and resets for the next press', async () => {
    engine.handleHotkey({ type: 'down' });
    await flush();
    engine.handleRecorderEvent({ type: 'failed', sessionId: 1, message: 'No microphone was found.' });
    expect(statuses.at(-1)).toMatchObject({ phase: 'error', title: 'Microphone error' });

    engine.handleHotkey({ type: 'up' });
    engine.handleHotkey({ type: 'down' });
    await flush();
    expect(commands.filter((command) => command.type === 'start')).toHaveLength(2);
  });
});
