import { clipboard } from 'electron';

import type { AppRule, AppSettings, AppStatus, CorrectionEntry, DictionaryEntry, EnhancementLevel, FocusInfo, ProcessAudioResult, StyleMode } from '../shared/types';
import { getApiKey, isApiKeySet } from './api-key';
import { resolveStyleForApp } from './app-rules';
import { CloudTranscriptionError, transcribeWithCloud } from './cloud-transcription';
import { buildDictionaryContext, buildWhisperPrompt } from './dictionary';
import { rewriteWithCloud } from './cloud-rewrite';
import { resolveRewriteFallback, resolveRewriteTarget } from './rewrite-provider';
import { getEnhancementPrompt, getRewriteUserMessage } from './prompts';
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
  getStatus: () => AppStatus;
}

export interface TranscriptionResult {
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
        console.warn('[yap] Cloud transcription failed, falling back to local Whisper:', error.message);
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
  getStatus,
}: ProcessDictationOptions): Promise<ProcessAudioResult> {
  const whisperPrompt = buildWhisperPrompt(dictionary, corrections);
  const dictionaryContext = buildDictionaryContext(dictionary, corrections);

  const resolved = resolveStyleForApp(
    targetFocus,
    appRules,
    settings.styleMode,
    settings.enhancementLevel,
  );

  console.log('[yap:dictation] start', {
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

  console.log('[yap:dictation] raw', { source: transcriptionSource, text: rawText });

  if (!rawText) {
    setStatus({
      phase: 'error',
      title: 'Nothing heard',
      detail: 'Yap did not detect enough speech to transcribe.',
    });
    throw new Error('No speech was detected in the recording.');
  }

  const enhancementPrompt = getEnhancementPrompt({
    style: resolved.styleMode,
    level: resolved.enhancementLevel,
    dictionaryContext,
    language: settings.cloudLanguage,
    customPlusVoice: settings.customPlusVoice,
  });
  const rewriteUserMessage = getRewriteUserMessage(resolved.styleMode, rawText);
  let finalText = rawText;
  let usedRewriteFallback = false;

  const rewriteTarget = settings.rewriteMode === 'cloud' ? resolveRewriteTarget(settings) : null;
  const fallbackPolicy = resolveRewriteFallback({
    provider: settings.cloudRewriteProvider,
  });

  let rewriteFailureDetail: string | undefined;

  if (rewriteTarget) {
    setStatus({
      phase: 'rewriting',
      title: 'Polishing',
      detail: `${rewriteTarget.model} is polishing your text via cloud.`,
      preview: rawText,
      rawText,
    });

    try {
      finalText = await rewriteWithCloud({
        baseUrl: rewriteTarget.baseUrl,
        apiKey: rewriteTarget.apiKey,
        model: rewriteTarget.model,
        systemPrompt: enhancementPrompt,
        userMessage: rewriteUserMessage,
        rawText,
        extraHeaders: rewriteTarget.extraHeaders,
        providerOptions: rewriteTarget.providerOptions,
        timeoutMs: rewriteTarget.timeoutMs,
      });
    } catch (cloudError) {
      const message = cloudError instanceof Error ? cloudError.message : String(cloudError);
      if (!fallbackPolicy.retryLocallyAfterCloudFailure) {
        console.warn(`[yap] ${fallbackPolicy.providerLabel} rewrite failed, keeping raw text:`, message);
        usedRewriteFallback = true;
        rewriteFailureDetail = `${fallbackPolicy.providerLabel} rewrite failed. The raw transcription was used instead.`;
      } else {
        console.warn('[yap] Cloud rewrite failed, falling back to Ollama:', message);
        try {
          setStatus({
            phase: 'rewriting',
            title: 'Polishing locally',
            detail: `Cloud unavailable, using ${settings.textModel} via Ollama.`,
            preview: rawText,
            rawText,
          });
          finalText = await rewriteWithOllama({
            baseUrl: settings.ollamaBaseUrl,
            modelName: settings.textModel,
            systemPrompt: enhancementPrompt,
            userMessage: rewriteUserMessage,
            rawText,
          });
        } catch {
          usedRewriteFallback = true;
        }
      }
    }
  } else {
    setStatus({
      phase: 'rewriting',
      title: 'Polishing',
      detail: `${settings.textModel} is applying the selected rewrite level.`,
      preview: rawText,
      rawText,
    });

    try {
      finalText = await rewriteWithOllama({
        baseUrl: settings.ollamaBaseUrl,
        modelName: settings.textModel,
        systemPrompt: enhancementPrompt,
        userMessage: rewriteUserMessage,
        rawText,
      });
    } catch (error) {
      usedRewriteFallback = true;
      setStatus({
        phase: 'error',
        title: 'Rewrite unavailable',
        detail: error instanceof Error ? error.message : 'Could not rewrite.',
        preview: rawText,
        rawText,
      });
    }
  }

  console.log('[yap:dictation] final', { rewriteFallback: usedRewriteFallback, text: finalText });

  let pasted = false;
  let focusInfo = targetFocus;

  if (settings.autoPaste) {
    clipboard.writeText(finalText);

    setStatus({
      phase: 'pasting',
      title: 'Pasting',
      detail: 'Sending the polished text to the active app.',
      preview: finalText,
      rawText,
    });

    focusInfo = targetFocus ?? (await getFocusInfo().catch(() => undefined));
    pasted = await triggerPaste(focusInfo).catch(() => false);

    if (!settings.copyToClipboard) {
      setTimeout(() => clipboard.writeText(''), 500);
    }
  } else if (settings.copyToClipboard) {
    clipboard.writeText(finalText);
  }

  const doneTitle = pasted ? 'Pasted' : 'Done';
  const baseDoneDetail = rewriteFailureDetail
    ? pasted
      ? `${rewriteFailureDetail} The raw text was pasted.`
      : `${rewriteFailureDetail} The raw text was saved to history.`
    : usedRewriteFallback
      ? pasted
        ? 'The raw transcription was pasted because the rewrite model was unavailable.'
        : 'The raw transcription was saved to history because the rewrite model was unavailable.'
      : pasted
        ? 'The refined text was pasted into the active app.'
        : 'The refined text was saved to history.';

  const doneDetail = baseDoneDetail;

  const doneStatus: AppStatus = {
    phase: 'done',
    title: doneTitle,
    detail: doneDetail,
    preview: finalText,
    rawText,
  };
  setStatus(doneStatus);

  setTimeout(() => {
    // Renderer may emit its own `done` status via `pushStatus` after
    // `processAudio` resolves, producing a different object reference.
    // Compare by phase so the idle reset still fires; bail out only if a
    // new dictation cycle moved the state to a non-done phase.
    if (getStatus().phase === 'done') {
      setStatus(createIdleStatus());
    }
  }, 1_500);

  return {
    rawText,
    finalText,
    pasted,
    focusInfo,
    transcriptionSource,
    styleMode: resolved.styleMode,
    enhancementLevel: resolved.enhancementLevel,
  };
}

export function getInitialStatus(): AppStatus {
  return createIdleStatus();
}

export interface TranscribeAudioOptions {
  wavBase64: string;
  settings: AppSettings;
  dictionary: DictionaryEntry[];
  corrections: CorrectionEntry[];
  setStatus?: (status: AppStatus) => void;
}

export async function runTranscription(options: TranscribeAudioOptions): Promise<TranscriptionResult> {
  const whisperPrompt = buildWhisperPrompt(options.dictionary, options.corrections);
  const noop = () => {};
  return transcribe(options.wavBase64, options.settings, options.setStatus ?? noop, whisperPrompt);
}

export interface RewriteAudioOptions {
  rawText: string;
  settings: AppSettings;
  styleMode: StyleMode;
  enhancementLevel: EnhancementLevel;
  dictionary: DictionaryEntry[];
  corrections: CorrectionEntry[];
  setStatus?: (status: AppStatus) => void;
}

export async function runRewrite(options: RewriteAudioOptions): Promise<{ finalText: string; usedFallback: boolean; notice?: string }> {
  const noop = () => {};
  const setStatus = options.setStatus ?? noop;
  const dictionaryContext = buildDictionaryContext(options.dictionary, options.corrections);
  const styleMode = options.styleMode;
  const enhancementLevel = options.enhancementLevel;
  const enhancementPrompt = getEnhancementPrompt({
    style: styleMode,
    level: enhancementLevel,
    dictionaryContext,
    language: options.settings.cloudLanguage,
    customPlusVoice: options.settings.customPlusVoice,
  });
  const rewriteUserMessage = getRewriteUserMessage(styleMode, options.rawText);

  let finalText = options.rawText;
  let usedFallback = false;

  const rewriteTarget = options.settings.rewriteMode === 'cloud'
    ? resolveRewriteTarget(options.settings)
    : null;
  const fallbackPolicy = resolveRewriteFallback({
    provider: options.settings.cloudRewriteProvider,
  });

  if (rewriteTarget) {
    setStatus({
      phase: 'rewriting',
      title: 'Polishing',
      detail: `${rewriteTarget.model} is polishing your text via cloud.`,
      preview: options.rawText,
      rawText: options.rawText,
    });

    try {
      finalText = await rewriteWithCloud({
        baseUrl: rewriteTarget.baseUrl,
        apiKey: rewriteTarget.apiKey,
        model: rewriteTarget.model,
        systemPrompt: enhancementPrompt,
        userMessage: rewriteUserMessage,
        rawText: options.rawText,
        extraHeaders: rewriteTarget.extraHeaders,
        providerOptions: rewriteTarget.providerOptions,
        timeoutMs: rewriteTarget.timeoutMs,
      });
      return { finalText, usedFallback: false };
    } catch (cloudError) {
      const message = cloudError instanceof Error ? cloudError.message : String(cloudError);
      if (!fallbackPolicy.retryLocallyAfterCloudFailure) {
        console.warn(`[yap] ${fallbackPolicy.providerLabel} rewrite failed, keeping raw text:`, message);
        return {
          finalText: options.rawText,
          usedFallback: true,
          notice: `${fallbackPolicy.providerLabel} rewrite failed. The raw transcription was kept.`,
        };
      }
      console.warn('[yap] Cloud rewrite failed, falling back to Ollama:', message);
    }
  }

  try {
    setStatus({
      phase: 'rewriting',
      title: 'Polishing',
      detail: `${options.settings.textModel} is applying the selected rewrite level.`,
      preview: options.rawText,
      rawText: options.rawText,
    });
    finalText = await rewriteWithOllama({
      baseUrl: options.settings.ollamaBaseUrl,
      modelName: options.settings.textModel,
      systemPrompt: enhancementPrompt,
      userMessage: rewriteUserMessage,
      rawText: options.rawText,
    });
  } catch (error) {
    usedFallback = true;
    setStatus({
      phase: 'error',
      title: 'Rewrite unavailable',
      detail: error instanceof Error ? error.message : 'Could not rewrite.',
      preview: options.rawText,
      rawText: options.rawText,
    });
  }

  return { finalText, usedFallback };
}
