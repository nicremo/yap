import { describe, expect, it } from 'vitest';

import { createDefaultSettings } from '../../src/main/defaults';
import { applySettingsUpdate, migrateSettings } from '../../src/main/settings';

const defaults = createDefaultSettings();

/* What a 0.9.0 install wrote: the Groq key under its old name, the removed
   auto mode and the removed cloud rewrite providers. */
const versionOne = {
  storageDirectory: '/Users/me/Documents/Yap',
  whisperModel: 'onnx-community/whisper-base',
  whisperLabel: 'Whisper Base (Multilingual)',
  ollamaBaseUrl: 'http://127.0.0.1:11434',
  textModel: 'qwen3.5:2b',
  rewriteMode: 'cloud',
  cloudRewriteModel: 'openai/gpt-oss-120b',
  cloudRewriteProvider: 'groq',
  openrouterApiKeyEncrypted: 'or-cipher',
  openrouterModel: 'google/gemini-3.5-flash-lite',
  openrouterSpeedRouting: true,
  fireworksApiKeyEncrypted: '',
  fireworksModel: 'accounts/fireworks/routers/glm-5p2-fast',
  styleMode: 'custom-plus',
  customPlusVoice: 'developer',
  enhancementLevel: 'high',
  transcriptionMode: 'auto',
  cloudModel: 'whisper-large-v3-turbo',
  cloudApiBaseUrl: 'https://api.groq.com/openai',
  cloudLanguage: 'en',
  openaiApiKeyEncrypted: 'groq-cipher',
  hotkey: { keyCode: 61, modifiers: 0, label: 'Right ⌥' },
  autoPaste: true,
  copyToClipboard: false,
  showOverlay: false,
  launchAtLogin: true,
  setupComplete: true,
};

describe('migrateSettings', () => {
  it('keeps the Groq key and the user choices from a version one file', () => {
    const migrated = migrateSettings(versionOne, defaults);

    expect(migrated.settingsVersion).toBe(2);
    expect(migrated.groqApiKeyEncrypted).toBe('groq-cipher');
    expect(migrated.transcriptionMode).toBe('cloud');
    expect(migrated.cloudModel).toBe('whisper-large-v3-turbo');
    expect(migrated.language).toBe('en');
    expect(migrated.enhancementEnabled).toBe(true);
    expect(migrated.rewriteModel).toBe('openai/gpt-oss-120b');
    expect(migrated.styleMode).toBe('custom-plus');
    expect(migrated.customPlusVoice).toBe('developer');
    expect(migrated.enhancementLevel).toBe('high');
    expect(migrated.hotkey).toEqual({ keyCode: 61, modifiers: 0, label: 'Right ⌥' });
    expect(migrated.showOverlay).toBe(false);
    expect(migrated.launchAtLogin).toBe(true);
    expect(migrated.setupComplete).toBe(true);
    expect(migrated.storageDirectory).toBe('/Users/me/Documents/Yap');
  });

  it('drops every field of the removed providers', () => {
    const migrated = migrateSettings(versionOne, defaults) as unknown as Record<string, unknown>;

    for (const key of [
      'openaiApiKeyEncrypted',
      'openrouterApiKeyEncrypted',
      'fireworksApiKeyEncrypted',
      'ollamaBaseUrl',
      'textModel',
      'rewriteMode',
      'cloudRewriteProvider',
      'cloudApiBaseUrl',
      'whisperLabel',
    ]) {
      expect(migrated).not.toHaveProperty(key);
    }
    expect(Object.keys(migrated).sort()).toEqual(Object.keys(defaults).sort());
  });

  it('maps the removed auto mode to local when there is no key', () => {
    const migrated = migrateSettings({ ...versionOne, openaiApiKeyEncrypted: '' }, defaults);
    expect(migrated.transcriptionMode).toBe('local');
  });

  it('does not treat a key for another provider as a Groq key', () => {
    const migrated = migrateSettings({ ...versionOne, cloudApiBaseUrl: 'https://api.openai.com' }, defaults);
    expect(migrated.groqApiKeyEncrypted).toBe('');
  });

  it('turns polishing off for former Ollama users without a Groq key', () => {
    const migrated = migrateSettings({ ...versionOne, rewriteMode: 'local', openaiApiKeyEncrypted: '' }, defaults);
    expect(migrated.enhancementEnabled).toBe(false);
  });

  it('moves a retired rewrite model back to the default', () => {
    const migrated = migrateSettings({ ...versionOne, cloudRewriteModel: 'qwen/qwen3-32b' }, defaults);
    expect(migrated.rewriteModel).toBe(defaults.rewriteModel);
  });

  it('moves the Llama models, now enterprise only on Groq, back to the default', () => {
    // A version two file: the model is stored under rewriteModel only.
    for (const rewriteModel of ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant']) {
      expect(migrateSettings({ settingsVersion: 2, rewriteModel }, defaults).rewriteModel).toBe('openai/gpt-oss-20b');
    }
    expect(migrateSettings({ settingsVersion: 2, rewriteModel: 'qwen/qwen3.8-27b' }, defaults).rewriteModel).toBe('qwen/qwen3.8-27b');
  });

  it('rejects models that Groq does not serve for transcription', () => {
    const migrated = migrateSettings({ ...versionOne, cloudModel: 'gpt-4o-transcribe' }, defaults);
    expect(migrated.cloudModel).toBe(defaults.cloudModel);
  });

  it('defaults the theme to System and keeps a valid choice', () => {
    expect(migrateSettings({}, defaults).theme).toBe('system');
    expect(migrateSettings({ theme: 'light' }, defaults).theme).toBe('light');
    expect(migrateSettings({ theme: 'sepia' }, defaults).theme).toBe('system');
  });

  it('keeps a known setup step and resets anything else', () => {
    expect(migrateSettings({ setupStep: 'permissions' }, defaults).setupStep).toBe('permissions');
    expect(migrateSettings({ setupStep: 'nonsense' }, defaults).setupStep).toBe('welcome');
    expect(migrateSettings({}, defaults).setupStep).toBe('welcome');
  });

  it('falls back to the defaults for garbage', () => {
    expect(migrateSettings(undefined, defaults)).toEqual(defaults);
    expect(migrateSettings('nope', defaults)).toEqual(defaults);
    expect(migrateSettings({ styleMode: 'shouting', hotkey: { keyCode: 'x' } }, defaults)).toEqual(defaults);
  });

  it('is stable for files that are already current', () => {
    const once = migrateSettings(versionOne, defaults);
    expect(migrateSettings(once, defaults)).toEqual(once);
  });
});

describe('applySettingsUpdate', () => {
  it('applies valid changes and ignores invalid values', () => {
    const current = migrateSettings(versionOne, defaults);
    const next = applySettingsUpdate(current, {
      transcriptionMode: 'local',
      language: 'de',
      rewriteModel: 'not-a-model',
    });

    expect(next.transcriptionMode).toBe('local');
    expect(next.language).toBe('de');
    expect(next.rewriteModel).toBe(current.rewriteModel);
    expect(next.groqApiKeyEncrypted).toBe(current.groqApiKeyEncrypted);
  });
});
