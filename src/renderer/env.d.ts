/// <reference types="vite/client" />

import type {
  AppRule,
  AppStatus,
  BootstrapState,
  CorrectionEntry,
  DictionaryEntry,
  DictationRequest,
  FocusInfo,
  HotkeyEvent,
  UpdateSettingsInput,
} from '../shared/types';

declare global {
  interface Window {
    openWhisp: {
      bootstrap: () => Promise<BootstrapState>;
      updateSettings: (updates: UpdateSettingsInput) => Promise<BootstrapState>;
      chooseStorage: () => Promise<BootstrapState>;
      requestMicrophoneAccess: () => Promise<BootstrapState>;
      requestSystemAccess: () => Promise<BootstrapState>;
      prepareSpeechModel: () => Promise<BootstrapState>;
      refreshOllama: () => Promise<BootstrapState>;
      pullRecommendedModel: () => Promise<BootstrapState>;
      testApiKey: (apiKey: string, baseUrl?: string) => Promise<{ valid: boolean; error?: string }>;
      clearApiKey: () => Promise<BootstrapState>;
      addDictionaryWord: (word: string) => Promise<DictionaryEntry[]>;
      removeDictionaryWord: (word: string) => Promise<DictionaryEntry[]>;
      addCorrection: (from: string, to: string) => Promise<CorrectionEntry[]>;
      removeCorrection: (from: string) => Promise<CorrectionEntry[]>;
      addAppRule: (rule: AppRule) => Promise<AppRule[]>;
      removeAppRule: (appIdentifier: string) => Promise<AppRule[]>;
      updateAppRule: (appIdentifier: string, styleMode: string, enhancementLevel: string) => Promise<AppRule[]>;
      captureFocusTarget: () => Promise<FocusInfo>;
      processAudio: (request: DictationRequest) => Promise<{
        rawText: string;
        finalText: string;
        pasted: boolean;
      }>;
      pushStatus: (status: AppStatus) => void;
      showMainWindow: () => Promise<void>;
      hideMainWindow: () => Promise<void>;
      openExternal: (targetUrl: string) => Promise<void>;
      revealStorage: () => Promise<void>;
      onStatus: (listener: (status: AppStatus) => void) => () => void;
      onHotkey: (listener: (event: HotkeyEvent) => void) => () => void;
    };
  }
}

export {};
