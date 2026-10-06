import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

import type {
  AppRule,
  AppState,
  AppStatus,
  CorrectionEntry,
  DictionaryEntry,
  HistoryEntry,
  KeyValidationResult,
  PermissionKind,
  RecordedAudio,
  RecorderCommand,
  RecorderEvent,
  RetranscribeMode,
  UpdateSettingsInput,
} from '../shared/types';

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const wrapped = (_event: IpcRendererEvent, payload: T) => listener(payload);
  ipcRenderer.on(channel, wrapped);
  return () => {
    ipcRenderer.removeListener(channel, wrapped);
  };
}

const themeArgument = process.argv.find((argument) => argument.startsWith('--yap-theme='))?.slice('--yap-theme='.length);

const api = {
  /** The theme the window was opened with, before the state arrives. */
  initialTheme: themeArgument === 'light' || themeArgument === 'dark' ? themeArgument : 'system',
  getState: () => ipcRenderer.invoke('app:getState') as Promise<AppState>,
  updateSettings: (updates: UpdateSettingsInput) => ipcRenderer.invoke('settings:update', updates) as Promise<AppState>,
  chooseStorage: () => ipcRenderer.invoke('settings:chooseStorage') as Promise<AppState>,

  saveGroqKey: (key: string) =>
    ipcRenderer.invoke('groq:saveKey', key) as Promise<{ result: KeyValidationResult; state: AppState }>,
  clearGroqKey: () => ipcRenderer.invoke('groq:clearKey') as Promise<AppState>,
  downloadLocalModel: () => ipcRenderer.invoke('local:download') as Promise<AppState>,

  requestPermission: (kind: PermissionKind) => ipcRenderer.invoke('permissions:request', kind) as Promise<AppState>,
  openPermissionSettings: (kind: PermissionKind) => ipcRenderer.invoke('permissions:openSettings', kind) as Promise<void>,
  repairPermissions: () => ipcRenderer.invoke('permissions:repair') as Promise<AppState>,
  refreshPermissions: () => ipcRenderer.invoke('permissions:refresh') as Promise<AppState>,
  openKeyboardSettings: () => ipcRenderer.invoke('system:openKeyboardSettings') as Promise<void>,

  addDictionaryWord: (word: string) => ipcRenderer.invoke('dictionary:add', word) as Promise<DictionaryEntry[]>,
  removeDictionaryWord: (word: string) => ipcRenderer.invoke('dictionary:remove', word) as Promise<DictionaryEntry[]>,
  addCorrection: (from: string, to: string) => ipcRenderer.invoke('corrections:add', from, to) as Promise<CorrectionEntry[]>,
  removeCorrection: (from: string) => ipcRenderer.invoke('corrections:remove', from) as Promise<CorrectionEntry[]>,
  addAppRule: (rule: AppRule) => ipcRenderer.invoke('appRules:add', rule) as Promise<AppRule[]>,
  removeAppRule: (appIdentifier: string) => ipcRenderer.invoke('appRules:remove', appIdentifier) as Promise<AppRule[]>,
  updateAppRule: (appIdentifier: string, styleMode: string, enhancementLevel: string) =>
    ipcRenderer.invoke('appRules:update', appIdentifier, styleMode, enhancementLevel) as Promise<AppRule[]>,

  removeHistoryEntry: (id: string) => ipcRenderer.invoke('history:remove', id) as Promise<HistoryEntry[]>,
  clearHistory: () => ipcRenderer.invoke('history:clear') as Promise<HistoryEntry[]>,
  revealAudio: (id: string) => ipcRenderer.invoke('history:revealAudio', id) as Promise<void>,
  /** Hides Yap and pastes the dictation into the app behind it. */
  pasteHistoryEntry: (id: string, version: 'final' | 'raw') =>
    ipcRenderer.invoke('history:paste', id, version) as Promise<void>,
  retranscribe: (id: string, mode: RetranscribeMode) =>
    ipcRenderer.invoke('history:retranscribe', id, mode) as Promise<HistoryEntry[]>,

  showMainWindow: () => ipcRenderer.invoke('system:showMainWindow') as Promise<void>,
  openExternal: (url: string) => ipcRenderer.invoke('system:openExternal', url) as Promise<void>,
  revealStorage: () => ipcRenderer.invoke('system:revealStorage') as Promise<void>,

  onStatus: (listener: (status: AppStatus) => void) => subscribe('app:status', listener),
  onStatePatch: (listener: (patch: Partial<AppState>) => void) => subscribe('state:patch', listener),
  onHotkeyActivity: (listener: (down: boolean) => void) => subscribe('hotkey:activity', listener),

  /* Recorder protocol, used by the overlay window only. */
  onRecorderCommand: (listener: (command: RecorderCommand) => void) => subscribe('recorder:command', listener),
  sendRecorderEvent: (event: RecorderEvent) => ipcRenderer.send('recorder:event', event),
  sendRecordedAudio: (audio: RecordedAudio) => ipcRenderer.send('recorder:audio', audio),
};

export type YapApi = typeof api;

contextBridge.exposeInMainWorld('yap', api);
