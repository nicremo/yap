import { contextBridge, ipcRenderer } from 'electron';

import type {
  AppStatus,
  BootstrapState,
  CorrectionEntry,
  DictionaryEntry,
  DictationRequest,
  FocusInfo,
  HotkeyEvent,
  UpdateSettingsInput,
} from '../shared/types';

const api = {
  bootstrap: () => ipcRenderer.invoke('app:bootstrap') as Promise<BootstrapState>,
  updateSettings: (updates: UpdateSettingsInput) =>
    ipcRenderer.invoke('settings:update', updates) as Promise<BootstrapState>,
  chooseStorage: () => ipcRenderer.invoke('settings:chooseStorage') as Promise<BootstrapState>,
  requestMicrophoneAccess: () =>
    ipcRenderer.invoke('permissions:requestMicrophone') as Promise<BootstrapState>,
  requestSystemAccess: () =>
    ipcRenderer.invoke('permissions:requestSystem') as Promise<BootstrapState>,
  prepareSpeechModel: () =>
    ipcRenderer.invoke('models:prepareSpeech') as Promise<BootstrapState>,
  refreshOllama: () => ipcRenderer.invoke('models:refreshOllama') as Promise<BootstrapState>,
  pullRecommendedModel: () =>
    ipcRenderer.invoke('models:pullRecommended') as Promise<BootstrapState>,
  testApiKey: (apiKey: string, baseUrl?: string) =>
    ipcRenderer.invoke('openai:testKey', apiKey, baseUrl) as Promise<{ valid: boolean; error?: string }>,
  clearApiKey: () =>
    ipcRenderer.invoke('openai:clearKey') as Promise<BootstrapState>,
  addDictionaryWord: (word: string) =>
    ipcRenderer.invoke('dictionary:add', word) as Promise<DictionaryEntry[]>,
  removeDictionaryWord: (word: string) =>
    ipcRenderer.invoke('dictionary:remove', word) as Promise<DictionaryEntry[]>,
  addCorrection: (from: string, to: string) =>
    ipcRenderer.invoke('corrections:add', from, to) as Promise<CorrectionEntry[]>,
  removeCorrection: (from: string) =>
    ipcRenderer.invoke('corrections:remove', from) as Promise<CorrectionEntry[]>,
  captureFocusTarget: () =>
    ipcRenderer.invoke('dictation:captureTarget') as Promise<FocusInfo>,
  processAudio: (request: DictationRequest) =>
    ipcRenderer.invoke('dictation:processAudio', request) as Promise<{
      rawText: string;
      finalText: string;
      pasted: boolean;
    }>,
  pushStatus: (status: AppStatus) => ipcRenderer.send('dictation:status', status),
  showMainWindow: () => ipcRenderer.invoke('system:showMainWindow'),
  hideMainWindow: () => ipcRenderer.invoke('system:hideMainWindow'),
  openExternal: (targetUrl: string) => ipcRenderer.invoke('system:openExternal', targetUrl),
  revealStorage: () => ipcRenderer.invoke('system:revealStorage'),
  onStatus: (listener: (status: AppStatus) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, status: AppStatus) => listener(status);
    ipcRenderer.on('app:status', wrapped);
    return () => ipcRenderer.removeListener('app:status', wrapped);
  },
  onHotkey: (listener: (event: HotkeyEvent) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, event: HotkeyEvent) => listener(event);
    ipcRenderer.on('hotkey:event', wrapped);
    return () => ipcRenderer.removeListener('hotkey:event', wrapped);
  },
};

contextBridge.exposeInMainWorld('openWhisp', api);
