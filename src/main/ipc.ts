import { ipcMain, shell, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';

import type {
  AppRule,
  AppSettings,
  AppState,
  EnhancementLevel,
  RuleLevel,
  KeyValidationResult,
  PermissionKind,
  RecordedAudio,
  RecorderEvent,
  RetranscribeMode,
  StyleMode,
  UpdateSettingsInput,
} from '../shared/types';
import { addAppRule, removeAppRule, updateAppRule } from './app-rules';
import { addCorrection, addDictionaryEntry, removeCorrection, removeDictionaryEntry } from './dictionary';
import type { DictationEngine } from './dictation/engine';
import { clearHistory, loadHistory, removeHistoryEntry } from './history';
import { deleteAudioRecording, resolveAudioPath } from './audio-store';

export interface IpcController {
  engine: DictationEngine;
  getState(): Promise<AppState>;
  getSettings(): AppSettings;
  updateSettings(updates: UpdateSettingsInput): Promise<AppState>;
  saveGroqKey(key: string): Promise<{ result: KeyValidationResult; state: AppState }>;
  clearGroqKey(): Promise<AppState>;
  downloadLocalModel(): Promise<AppState>;
  requestPermission(kind: PermissionKind): Promise<AppState>;
  openPermissionSettings(kind: PermissionKind): Promise<void>;
  repairPermissions(): Promise<AppState>;
  refreshPermissions(): Promise<AppState>;
  openKeyboardSettings(): Promise<void>;
  chooseStorage(): Promise<AppState>;
  revealStorage(): Promise<void>;
  showMainWindow(): void;
  pasteHistoryEntry(id: string, version: 'final' | 'raw'): Promise<void>;
  isRecorder(sender: Electron.WebContents): boolean;
  patch(state: Partial<AppState>): void;
}

const PERMISSION_KINDS: readonly PermissionKind[] = ['microphone', 'accessibility', 'inputMonitoring'];
const STYLE_MODES: readonly StyleMode[] = ['conversation', 'vibe-coding', 'custom-plus'];
const LEVELS: readonly EnhancementLevel[] = ['none', 'soft', 'medium', 'high'];
/** An app rule can also turn polishing off for its app. */
const RULE_LEVELS: readonly RuleLevel[] = [...LEVELS, 'off'];
const EXTERNAL_PROTOCOLS = ['https:', 'http:', 'x-apple.systempreferences:', 'ms-settings:'];

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`Expected a string for ${label}.`);
  return value;
}

function requirePermissionKind(value: unknown): PermissionKind {
  if (!PERMISSION_KINDS.includes(value as PermissionKind)) throw new Error('Unknown permission.');
  return value as PermissionKind;
}

function handle<Args extends unknown[], Result>(
  channel: string,
  listener: (event: IpcMainInvokeEvent, ...args: Args) => Promise<Result> | Result,
): void {
  ipcMain.handle(channel, (event, ...args) => listener(event, ...(args as Args)));
}

export function registerIpcHandlers(controller: IpcController): void {
  handle('app:getState', () => controller.getState());

  handle('settings:update', (_event, updates: unknown) => {
    if (!updates || typeof updates !== 'object') throw new Error('Expected a settings object.');
    return controller.updateSettings(updates as UpdateSettingsInput);
  });
  handle('settings:chooseStorage', () => controller.chooseStorage());

  handle('groq:saveKey', (_event, key: unknown) => controller.saveGroqKey(requireString(key, 'the API key')));
  handle('groq:clearKey', () => controller.clearGroqKey());
  handle('local:download', () => controller.downloadLocalModel());

  handle('permissions:request', (_event, kind: unknown) => controller.requestPermission(requirePermissionKind(kind)));
  handle('permissions:openSettings', (_event, kind: unknown) =>
    controller.openPermissionSettings(requirePermissionKind(kind)),
  );
  handle('permissions:repair', () => controller.repairPermissions());
  handle('permissions:refresh', () => controller.refreshPermissions());
  handle('system:openKeyboardSettings', () => controller.openKeyboardSettings());

  handle('dictionary:add', async (_event, word: unknown) => {
    const dictionary = await addDictionaryEntry(requireString(word, 'the word'));
    controller.patch({ dictionary });
    return dictionary;
  });
  handle('dictionary:remove', async (_event, word: unknown) => {
    const dictionary = await removeDictionaryEntry(requireString(word, 'the word'));
    controller.patch({ dictionary });
    return dictionary;
  });
  handle('corrections:add', async (_event, from: unknown, to: unknown) => {
    const corrections = await addCorrection(requireString(from, 'the misspelling'), requireString(to, 'the correction'));
    controller.patch({ corrections });
    return corrections;
  });
  handle('corrections:remove', async (_event, from: unknown) => {
    const corrections = await removeCorrection(requireString(from, 'the misspelling'));
    controller.patch({ corrections });
    return corrections;
  });

  handle('appRules:add', async (_event, rule: unknown) => {
    const candidate = rule as AppRule;
    if (
      !candidate ||
      typeof candidate.appIdentifier !== 'string' ||
      typeof candidate.label !== 'string' ||
      !STYLE_MODES.includes(candidate.styleMode) ||
      !RULE_LEVELS.includes(candidate.enhancementLevel)
    ) {
      throw new Error('Invalid app rule.');
    }
    const appRules = await addAppRule(candidate);
    controller.patch({ appRules });
    return appRules;
  });
  handle('appRules:remove', async (_event, appIdentifier: unknown) => {
    const appRules = await removeAppRule(requireString(appIdentifier, 'the app'));
    controller.patch({ appRules });
    return appRules;
  });
  handle('appRules:update', async (_event, appIdentifier: unknown, styleMode: unknown, level: unknown) => {
    if (!STYLE_MODES.includes(styleMode as StyleMode) || !RULE_LEVELS.includes(level as RuleLevel)) {
      throw new Error('Invalid app rule update.');
    }
    const appRules = await updateAppRule(requireString(appIdentifier, 'the app'), styleMode as StyleMode, level as RuleLevel);
    controller.patch({ appRules });
    return appRules;
  });

  handle('history:remove', async (_event, id: unknown) => {
    const entryId = requireString(id, 'the entry');
    const target = (await loadHistory()).find((entry) => entry.id === entryId);
    if (target?.audioFilename) {
      await deleteAudioRecording(controller.getSettings(), target.audioFilename);
    }
    const history = await removeHistoryEntry(entryId);
    controller.patch({ history });
    return history;
  });
  handle('history:clear', async () => {
    for (const entry of await loadHistory()) {
      if (entry.audioFilename) {
        await deleteAudioRecording(controller.getSettings(), entry.audioFilename).catch(() => undefined);
      }
    }
    const history = await clearHistory();
    controller.patch({ history });
    return history;
  });
  handle('history:revealAudio', async (_event, id: unknown) => {
    const entryId = requireString(id, 'the entry');
    const target = (await loadHistory()).find((entry) => entry.id === entryId);
    if (!target?.audioFilename) throw new Error('This dictation has no audio file anymore.');
    shell.showItemInFolder(resolveAudioPath(controller.getSettings(), target.audioFilename));
  });
  handle('history:paste', async (_event, id: unknown, version: unknown) => {
    if (version !== 'final' && version !== 'raw') throw new Error('Invalid text version.');
    await controller.pasteHistoryEntry(requireString(id, 'the entry'), version);
  });
  handle('history:retranscribe', async (_event, id: unknown, mode: unknown) => {
    if (mode !== 'transcribe-only' && mode !== 'transcribe-and-stylize') {
      throw new Error('Invalid retranscription mode.');
    }
    return controller.engine.retranscribe(requireString(id, 'the entry'), mode as RetranscribeMode);
  });

  handle('system:showMainWindow', () => controller.showMainWindow());
  handle('system:openExternal', async (_event, target: unknown) => {
    const url = new URL(requireString(target, 'the link'));
    if (!EXTERNAL_PROTOCOLS.includes(url.protocol)) throw new Error('This link type cannot be opened.');
    await shell.openExternal(url.toString());
  });
  handle('system:revealStorage', () => controller.revealStorage());

  ipcMain.on('recorder:event', (event: IpcMainEvent, payload: RecorderEvent) => {
    if (controller.isRecorder(event.sender) && payload && typeof payload.sessionId === 'number') {
      controller.engine.handleRecorderEvent(payload);
    }
  });
  ipcMain.on('recorder:audio', (event: IpcMainEvent, payload: RecordedAudio) => {
    if (controller.isRecorder(event.sender) && payload && typeof payload.sessionId === 'number' && payload.wav) {
      controller.engine.handleRecordedAudio(payload);
    }
  });
}
