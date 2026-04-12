import { clipboard } from 'electron';

import type { AppRule, AppSettings, AppStatus, CorrectionEntry, DictionaryEntry, FocusInfo, ProcessAudioResult } from '../shared/types';
import { getApiKey, isApiKeySet } from './api-key';
import { resolveStyleForApp } from './app-rules';
import { CloudTranscriptionError, transcribeWithCloud } from './cloud-transcription';
import { buildDictionaryContext, buildWhisperPrompt } from './dictionary';
import { getEnhancementPrompt } from './prompts';
import { rewriteWithOllama } from './ollama';
import { getFocusInfo, triggerPaste } from './native-helper';
import { ensureStorage } from './storage';

interface ProcessDictationOptions {
  wavBase64: string;
  settings: AppSettings;
  dictionary: DictionaryEntry[];
  corrections: CorrectionEntry[];
  appRules: AppRule[];
  targetFocus?: FocusInfo;
  setStatus: (status: AppStatus) => void;
}

interface TranscriptionResult {
  text: string;
  source: 'cloud' | 'local';
}

function createIdleStatus(): AppStatus {
  return {
    phase: 'idle',
    title: 'Ready',
    detail: 'Hold Fn to dictate. Release Fn to paste.',
  };
}

async function transcribeViaCloud(
  wavBase64: string,
  settings: AppSettings,
  whisperPrompt?: string,
): Promise<string> {
  const apiKey = getApiKey(settings);
  if (!apiKey) {
    throw new CloudTranscriptionError({ kind: 'auth', cause: 'No API key configured.' });
  }

  return transcribeWithCloud(
    wavBase64,
    apiKey,
    settings.cloudModel,
    settings.cloudApiBaseUrl,
    settings.cloudLanguage || undefined,
    whisperPrompt || undefined,
  );
}

async function transcribeLocally(
  wavBase64: string,
  settings: AppSettings,
): Promise<string> {
  const storage = await ensureStorage(settings);
  const { transcribeRecording } = await import('./transcription');
  return transcribeRecording(wavBase64, settings, storage);
}

async function transcribe(
  wavBase64: string,
  settings: AppSettings,
  setStatus: (status: AppStatus) => void,
  whisperPrompt?: string,
): Promise<TranscriptionResult> {
  if (settings.transcriptionMode === 'local') {
    setStatus({
      phase: 'transcribing',
      title: 'Transcribing',
      detail: `${settings.whisperLabel} is turning your voice into text.`,
    });

    const text = await transcribeLocally(wavBase64, settings);
    return { text, source: 'local' };
  }

  if (settings.transcriptionMode === 'cloud') {
    setStatus({
      phase: 'transcribing',
      title: 'Transcribing',
      detail: `Transcribing via OpenAI (${settings.cloudModel}).`,
    });

    const text = await transcribeViaCloud(wavBase64, settings, whisperPrompt);
    return { text, source: 'cloud' };
  }

  if (isApiKeySet(settings)) {
    setStatus({
      phase: 'transcribing',
      title: 'Transcribing',
      detail: `Transcribing via OpenAI (${settings.cloudModel}).`,
    });

    try {
      const text = await transcribeViaCloud(wavBase64, settings, whisperPrompt);
      return { text, source: 'cloud' };
    } catch (error) {
      if (error instanceof CloudTranscriptionError && error.isRetryable) {
        console.warn('[openwhisp] Cloud transcription failed, falling back to local Whisper:', error.message);
        setStatus({
          phase: 'transcribing',
          title: 'Transcribing locally',
          detail: `Cloud unavailable, using ${settings.whisperLabel} as fallback.`,
        });

        const text = await transcribeLocally(wavBase64, settings);
        return { text, source: 'local' };
      }

      throw error;
    }
  }

  setStatus({
    phase: 'transcribing',
    title: 'Transcribing',
    detail: `${settings.whisperLabel} is turning your voice into text.`,
  });

  const text = await transcribeLocally(wavBase64, settings);
  return { text, source: 'local' };
}

export async function processDictationAudio({
  wavBase64,
  settings,
  dictionary,
  corrections,
  appRules,
  targetFocus,
  setStatus,
}: ProcessDictationOptions): Promise<ProcessAudioResult> {
  const whisperPrompt = buildWhisperPrompt(dictionary, corrections);
  const dictionaryContext = buildDictionaryContext(dictionary, corrections);

  const resolved = resolveStyleForApp(
    targetFocus,
    appRules,
    settings.styleMode,
    settings.enhancementLevel,
  );

  console.log('[openwhisp:dictation] start', {
    mode: settings.transcriptionMode,
    cloudModel: settings.cloudModel,
    language: settings.cloudLanguage,
    style: resolved.styleMode,
    enhancement: resolved.enhancementLevel,
    matchedApp: resolved.matchedApp ?? 'default',
    textModel: settings.textModel,
    dictWords: dictionary.length,
    corrections: corrections.length,
  });

  const { text: rawText, source: transcriptionSource } = await transcribe(wavBase64, settings, setStatus, whisperPrompt);

  console.log('[openwhisp:dictation] raw', { source: transcriptionSource, text: rawText });

  if (!rawText) {
    setStatus({
      phase: 'error',
      title: 'Nothing heard',
      detail: 'OpenWhisp did not detect enough speech to transcribe.',
    });
    throw new Error('No speech was detected in the recording.');
  }

  setStatus({
    phase: 'rewriting',
    title: 'Polishing',
    detail: `${settings.textModel} is applying the selected rewrite level. The first request can take a moment while Ollama warms the model.`,
    preview: rawText,
    rawText,
  });

  let finalText = rawText;
  let usedRewriteFallback = false;

  try {
    finalText = await rewriteWithOllama(
      settings.ollamaBaseUrl,
      settings.textModel,
      getEnhancementPrompt(resolved.styleMode, resolved.enhancementLevel, dictionaryContext),
      rawText,
    );
  } catch (error) {
    usedRewriteFallback = true;
    setStatus({
      phase: 'error',
      title: 'Rewrite unavailable',
      detail:
        error instanceof Error
          ? `${error.message} OpenWhisp will use the raw transcription for now.`
          : 'OpenWhisp could not finish the rewrite pass, so it will use the raw transcription.',
      preview: rawText,
      rawText,
    });
  }

  console.log('[openwhisp:dictation] final', { rewriteFallback: usedRewriteFallback, text: finalText });

  clipboard.writeText(finalText);

  let pasted = false;
  let focusInfo = targetFocus;

  if (settings.autoPaste) {
    setStatus({
      phase: 'pasting',
      title: 'Pasting',
      detail: 'Sending the polished text to the active app.',
      preview: finalText,
      rawText,
    });

    focusInfo = targetFocus ?? (await getFocusInfo().catch(() => undefined));
    pasted = await triggerPaste(focusInfo).catch(() => false);
  }

  setStatus({
    phase: 'done',
    title: pasted ? 'Pasted' : 'Copied',
    detail: usedRewriteFallback
      ? pasted
        ? 'The raw transcription was pasted because the rewrite model was unavailable.'
        : 'The raw transcription is on the clipboard because the rewrite model was unavailable.'
      : pasted
        ? 'The refined text was pasted into the active app.'
        : focusInfo?.appName
          ? `OpenWhisp copied the text, but it could not paste into ${focusInfo.appName}.`
          : 'The refined text is on the clipboard.',
    preview: finalText,
    rawText,
  });

  setTimeout(() => {
    setStatus(createIdleStatus());
  }, 1_500);

  return {
    rawText,
    finalText,
    pasted,
    focusInfo,
    transcriptionSource,
  };
}

export function getInitialStatus(): AppStatus {
  return createIdleStatus();
}
