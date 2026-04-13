import { app } from 'electron';
import path from 'node:path';

import type { AppSettings, EnhancementLevel } from '../shared/types';
import { DEFAULT_HOTKEY, DEFAULT_HOTKEY_WINDOWS } from '../shared/hotkeys';
import {
  RECOMMENDED_CLOUD_MODEL,
  RECOMMENDED_TEXT_MODEL,
  RECOMMENDED_WHISPER_LABEL,
  RECOMMENDED_WHISPER_MODEL,
} from '../shared/recommendations';

export const APP_NAME = 'OpenWhisp';

export const ENHANCEMENT_LABELS: Record<EnhancementLevel, string> = {
  none: 'No filter',
  soft: 'Soft',
  medium: 'Medium',
  high: 'High',
};

export function getDefaultStorageDirectory(): string {
  return path.join(app.getPath('documents'), APP_NAME);
}

export function createDefaultSettings(): AppSettings {
  return {
    storageDirectory: getDefaultStorageDirectory(),
    whisperModel: RECOMMENDED_WHISPER_MODEL,
    whisperLabel: RECOMMENDED_WHISPER_LABEL,
    ollamaBaseUrl: 'http://127.0.0.1:11434',
    textModel: RECOMMENDED_TEXT_MODEL,
    rewriteMode: 'cloud',
    cloudRewriteModel: 'openai/gpt-oss-20b',
    styleMode: 'conversation',
    enhancementLevel: 'medium',
    transcriptionMode: 'auto',
    cloudModel: RECOMMENDED_CLOUD_MODEL,
    cloudApiBaseUrl: 'https://api.groq.com/openai',
    cloudLanguage: 'de',
    openaiApiKeyEncrypted: '',
    hotkey: process.platform === 'win32' ? DEFAULT_HOTKEY_WINDOWS : DEFAULT_HOTKEY,
    autoPaste: true,
    copyToClipboard: false,
    showOverlay: false,
    launchAtLogin: false,
    setupComplete: false,
  };
}
