import { ipcMain, shell } from 'electron';
import { randomUUID } from 'node:crypto';

import type {
  AppSettings,
  AppStatus,
  BootstrapState,
  DictationRequest,
  RetranscribeMode,
  UpdateSettingsInput,
} from '../shared/types';
import { RECOMMENDED_TEXT_MODEL } from '../shared/recommendations';
import { isApiKeySet, isFireworksApiKeySet, isOpenrouterApiKeySet } from './api-key';
import { testCloudConnection } from './cloud-transcription';
import { loadAppRules, addAppRule, removeAppRule, updateAppRule } from './app-rules';
import { loadDictionary, addDictionaryEntry, removeDictionaryEntry, loadCorrections, addCorrection, removeCorrection } from './dictionary';
import { processDictationAudio } from './dictation';
import {
  addHistoryEntry,
  clearAudioReferences,
  clearHistory,
  loadHistory,
  removeHistoryEntry,
  updateHistoryEntry,
} from './history';
import {
  deleteAudioRecording,
  resolveAudioPath,
  sweepAudioStore,
  writeAudioRecording,
} from './audio-store';
import { retranscribeEntry } from './retranscribe';
import { testFireworksConnection, testOpenrouterConnection } from './rewrite-provider';
import { applyLaunchAtLogin } from './login-item';
import { pullOllamaModel, listOllamaModels, isOllamaReachable, ensureOllamaRunning } from './ollama';
import { getFocusInfo } from './native-helper';
import { getPermissionState, requestMicrophoneAccess, requestSystemAccess } from './permissions';
import { updateSettings as persistSettings, chooseStorageDirectory } from './settings';
import { directoryHasEntries, ensureStorage } from './storage';

interface IpcDependencies {
  getSettings: () => AppSettings;
  setSettings: (settings: AppSettings) => void;
  getStatus: () => AppStatus;
  setStatus: (status: AppStatus) => void;
  getHelperReady: () => boolean;
  showMainWindow: () => void;
  hideMainWindow: () => void;
  ensureHotkeyListener: () => Promise<void>;
  restartHotkeyListener: () => Promise<void>;
  broadcast: (channel: string, payload: unknown) => void;
}

export function registerIpcHandlers(dependencies: IpcDependencies): void {
  const buildBootstrapState = async (): Promise<BootstrapState> => {
    const settings = dependencies.getSettings();
    const storage = await ensureStorage(settings);
    const permissions = await getPermissionState();
    if (permissions.accessibility && permissions.inputMonitoring && permissions.postEvents) {
      await dependencies.ensureHotkeyListener();
    }
    const needsOllama = settings.rewriteMode === 'local' && settings.enhancementLevel !== 'none';
    const ollamaReachable = needsOllama
      ? await ensureOllamaRunning(settings.ollamaBaseUrl)
      : await isOllamaReachable(settings.ollamaBaseUrl);
    const ollamaModels = ollamaReachable ? await listOllamaModels(settings.ollamaBaseUrl) : [];

    return {
      settings,
      permissions,
      ollamaReachable,
      ollamaModels,
      recommendedModelInstalled: ollamaModels.some(
        (model) => model.name === settings.textModel || model.name === RECOMMENDED_TEXT_MODEL,
      ),
      speechModelReady: await directoryHasEntries(storage.models),
      helperReady: dependencies.getHelperReady(),
      openaiApiKeySet: isApiKeySet(settings),
      openrouterApiKeySet: isOpenrouterApiKeySet(settings),
      fireworksApiKeySet: isFireworksApiKeySet(settings),
      dictionary: await loadDictionary(),
      corrections: await loadCorrections(),
      appRules: await loadAppRules(),
      history: await loadHistory(),
      status: dependencies.getStatus(),
    };
  };

  ipcMain.handle('app:bootstrap', buildBootstrapState);

  ipcMain.handle('settings:update', async (_event, updates: UpdateSettingsInput) => {
    const previousHotkey = dependencies.getSettings().hotkey;
    const nextSettings = await persistSettings(dependencies.getSettings(), updates);
    await ensureStorage(nextSettings);
    applyLaunchAtLogin(nextSettings.launchAtLogin);
    dependencies.setSettings(nextSettings);

    if (updates.hotkey && (
      updates.hotkey.keyCode !== previousHotkey.keyCode ||
      updates.hotkey.modifiers !== previousHotkey.modifiers
    )) {
      await dependencies.restartHotkeyListener();
    }

    return buildBootstrapState();
  });

  ipcMain.handle('settings:chooseStorage', async () => {
    const selected = await chooseStorageDirectory(dependencies.getSettings().storageDirectory);
    if (!selected) {
      return buildBootstrapState();
    }

    const nextSettings = await persistSettings(dependencies.getSettings(), {
      storageDirectory: selected,
    });

    await ensureStorage(nextSettings);
    dependencies.setSettings(nextSettings);
    return buildBootstrapState();
  });

  ipcMain.handle('permissions:requestMicrophone', async () => {
    await requestMicrophoneAccess();
    return buildBootstrapState();
  });

  ipcMain.handle('permissions:requestSystem', async () => {
    await requestSystemAccess();
    await dependencies.ensureHotkeyListener();
    return buildBootstrapState();
  });

  ipcMain.handle('models:prepareSpeech', async () => {
    const settings = dependencies.getSettings();
    dependencies.setStatus({
      phase: 'transcribing',
      title: 'Preparing speech model',
      detail: 'Downloading and warming the local Whisper model.',
    });

    const storage = await ensureStorage(settings);
    const { prepareTranscriber } = await import('./transcription');
    await prepareTranscriber(settings, storage);

    dependencies.setStatus({
      phase: 'idle',
      title: 'Ready',
      detail: 'Hold Fn to dictate. Release Fn to paste.',
    });

    return buildBootstrapState();
  });

  ipcMain.handle('models:refreshOllama', buildBootstrapState);

  ipcMain.handle('models:pullRecommended', async () => {
    const settings = dependencies.getSettings();
    if (!(await isOllamaReachable(settings.ollamaBaseUrl))) {
      throw new Error(
        `Ollama is not running at ${settings.ollamaBaseUrl}. Start the Ollama app or run \`ollama serve\`, then try again.`,
      );
    }

    dependencies.setStatus({
      phase: 'rewriting',
      title: 'Downloading model',
      detail: `Pulling ${RECOMMENDED_TEXT_MODEL} from Ollama.`,
    });

    await pullOllamaModel(settings.ollamaBaseUrl, RECOMMENDED_TEXT_MODEL, (detail) => {
      dependencies.setStatus({
        phase: 'rewriting',
        title: 'Downloading model',
        detail,
      });
    });

    dependencies.setStatus({
      phase: 'idle',
      title: 'Ready',
      detail: 'Hold Fn to dictate. Release Fn to paste.',
    });

    return buildBootstrapState();
  });

  ipcMain.handle('openai:testKey', async (_event, apiKey: string, baseUrl?: string) =>
    testCloudConnection(apiKey, baseUrl ?? dependencies.getSettings().cloudApiBaseUrl),
  );

  ipcMain.handle('openrouter:testKey', async (_event, apiKey: string) =>
    testOpenrouterConnection(apiKey),
  );

  ipcMain.handle('fireworks:testKey', async (_event, apiKey: string) =>
    testFireworksConnection(apiKey),
  );

  ipcMain.handle('openai:clearKey', async (_event, provider?: 'groq' | 'openrouter' | 'fireworks') => {
    const nextSettings = await persistSettings(
      dependencies.getSettings(),
      provider === 'openrouter'
        ? { openrouterApiKey: '' }
        : provider === 'fireworks'
          ? { fireworksApiKey: '' }
          : { openaiApiKey: '' },
    );
    dependencies.setSettings(nextSettings);
    return buildBootstrapState();
  });

  ipcMain.handle('dictionary:add', async (_event, word: unknown) => {
    if (typeof word !== 'string') throw new Error('Expected string for dictionary word.');
    return addDictionaryEntry(word);
  });

  ipcMain.handle('dictionary:remove', async (_event, word: unknown) => {
    if (typeof word !== 'string') throw new Error('Expected string for dictionary word.');
    return removeDictionaryEntry(word);
  });

  ipcMain.handle('corrections:add', async (_event, from: unknown, to: unknown) => {
    if (typeof from !== 'string' || typeof to !== 'string') throw new Error('Expected strings for correction.');
    return addCorrection(from, to);
  });

  ipcMain.handle('corrections:remove', async (_event, from: unknown) => {
    if (typeof from !== 'string') throw new Error('Expected string for correction.');
    return removeCorrection(from);
  });

  ipcMain.handle('appRules:add', async (_event, rule: unknown) => {
    if (!rule || typeof rule !== 'object') throw new Error('Expected object for app rule.');
    const r = rule as Record<string, unknown>;
    if (typeof r.appIdentifier !== 'string' || typeof r.label !== 'string') throw new Error('Invalid app rule.');
    return addAppRule(rule as import('../shared/types').AppRule);
  });

  ipcMain.handle('appRules:remove', async (_event, appIdentifier: unknown) => {
    if (typeof appIdentifier !== 'string') throw new Error('Expected string for app identifier.');
    return removeAppRule(appIdentifier);
  });

  ipcMain.handle('appRules:update', async (_event, appIdentifier: unknown, styleMode: unknown, enhancementLevel: unknown) => {
    if (typeof appIdentifier !== 'string' || typeof styleMode !== 'string' || typeof enhancementLevel !== 'string') {
      throw new Error('Invalid app rule update parameters.');
    }
    return updateAppRule(
      appIdentifier,
      styleMode as import('../shared/types').StyleMode,
      enhancementLevel as import('../shared/types').EnhancementLevel,
    );
  });

  ipcMain.handle('dictation:captureTarget', async () => getFocusInfo());

  ipcMain.handle('dictation:processAudio', async (_event, request: DictationRequest) => {
    const settings = dependencies.getSettings();
    const entryId = randomUUID();
    let audioFilename: string | null = null;

    try {
      const stored = await writeAudioRecording(settings, entryId, request.wavBase64);
      audioFilename = stored.filename;
    } catch (error) {
      console.warn('[openwhisp] Failed to persist audio file:', error instanceof Error ? error.message : error);
    }

    const { entry: pendingEntry, entries: pendingHistory } = await addHistoryEntry({
      id: entryId,
      rawText: '',
      finalText: '',
      transcriptionSource: null,
      styleMode: settings.styleMode,
      enhancementLevel: settings.enhancementLevel,
      appName: request.targetFocus?.appName,
      audioFilename,
      status: 'audio-only',
    });
    dependencies.broadcast('history:updated', pendingHistory);

    try {
      const result = await processDictationAudio({
        wavBase64: request.wavBase64,
        settings,
        dictionary: await loadDictionary(),
        corrections: await loadCorrections(),
        appRules: await loadAppRules(),
        targetFocus: request.targetFocus,
        setStatus: dependencies.setStatus,
        getStatus: dependencies.getStatus,
      });

      const { entries: updated } = await updateHistoryEntry(pendingEntry.id, {
        rawText: result.rawText,
        finalText: result.finalText,
        transcriptionSource: result.transcriptionSource,
        styleMode: result.styleMode,
        enhancementLevel: result.enhancementLevel,
        appName: result.focusInfo?.appName ?? pendingEntry.appName,
        status: 'success',
        errorMessage: undefined,
      });
      dependencies.broadcast('history:updated', updated);

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Dictation failed.';
      const { entries: failedHistory } = await updateHistoryEntry(pendingEntry.id, {
        status: 'transcription-failed',
        errorMessage: message,
      });
      dependencies.broadcast('history:updated', failedHistory);
      throw error;
    }
  });

  ipcMain.handle('history:remove', async (_event, id: unknown) => {
    if (typeof id !== 'string') throw new Error('Expected string for history entry id.');
    const entries = await loadHistory();
    const target = entries.find((entry) => entry.id === id);
    if (target?.audioFilename) {
      await deleteAudioRecording(dependencies.getSettings(), target.audioFilename);
    }
    return removeHistoryEntry(id);
  });

  ipcMain.handle('history:clear', async () => {
    const entries = await loadHistory();
    for (const entry of entries) {
      if (entry.audioFilename) {
        await deleteAudioRecording(dependencies.getSettings(), entry.audioFilename);
      }
    }
    return clearHistory();
  });

  ipcMain.handle('history:cleanup', async () => {
    const entries = await loadHistory();
    const sweep = await sweepAudioStore(dependencies.getSettings(), entries);
    if (sweep.expiredEntryIds.length > 0) {
      const updated = await clearAudioReferences(sweep.expiredEntryIds);
      dependencies.broadcast('history:updated', updated);
      return updated;
    }
    return entries;
  });

  ipcMain.handle('history:revealAudio', async (_event, id: unknown) => {
    if (typeof id !== 'string') throw new Error('Expected string for history entry id.');
    const entries = await loadHistory();
    const target = entries.find((entry) => entry.id === id);
    if (!target?.audioFilename) {
      throw new Error('No audio file is associated with this entry.');
    }
    const absolutePath = resolveAudioPath(dependencies.getSettings(), target.audioFilename);
    await shell.showItemInFolder(absolutePath);
  });

  ipcMain.handle('dictation:retranscribe', async (_event, id: unknown, mode: unknown) => {
    if (typeof id !== 'string') throw new Error('Expected string for history entry id.');
    if (mode !== 'transcribe-only' && mode !== 'transcribe-and-stylize') {
      throw new Error('Invalid retranscription mode.');
    }
    const entries = await loadHistory();
    const target = entries.find((entry) => entry.id === id);
    if (!target) throw new Error('History entry not found.');

    const updated = await retranscribeEntry({
      entry: target,
      mode: mode as RetranscribeMode,
      settings: dependencies.getSettings(),
      dictionary: await loadDictionary(),
      corrections: await loadCorrections(),
      appRules: await loadAppRules(),
      setStatus: dependencies.setStatus,
    });
    dependencies.broadcast('history:updated', updated);
    return updated;
  });

  ipcMain.on('dictation:status', (_event, status: AppStatus) => {
    dependencies.setStatus(status);
  });

  ipcMain.handle('system:showMainWindow', () => {
    dependencies.showMainWindow();
  });

  ipcMain.handle('system:hideMainWindow', () => {
    dependencies.hideMainWindow();
  });

  ipcMain.handle('system:openExternal', async (_event, targetUrl: string) => {
    await shell.openExternal(targetUrl);
  });

  ipcMain.handle('system:revealStorage', async () => {
    await shell.openPath(dependencies.getSettings().storageDirectory);
  });
}
