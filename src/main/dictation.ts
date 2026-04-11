import { clipboard } from 'electron';

import type { AppSettings, AppStatus, FocusInfo, ProcessAudioResult } from '../shared/types';
import { getEnhancementPrompt } from './prompts';
import { rewriteWithOllama } from './ollama';
import { getFocusInfo, triggerPaste } from './native-helper';
import { ensureStorage } from './storage';

interface ProcessDictationOptions {
  wavBase64: string;
  settings: AppSettings;
  targetFocus?: FocusInfo;
  setStatus: (status: AppStatus) => void;
}

function createIdleStatus(): AppStatus {
  return {
    phase: 'idle',
    title: 'Ready',
    detail: 'Hold Fn to dictate. Release Fn to paste.',
  };
}

export async function processDictationAudio({
  wavBase64,
  settings,
  targetFocus,
  setStatus,
}: ProcessDictationOptions): Promise<ProcessAudioResult> {
  const storage = await ensureStorage(settings);

  setStatus({
    phase: 'transcribing',
    title: 'Transcribing',
    detail: `${settings.whisperLabel} is turning your voice into text.`,
  });

  const { transcribeRecording } = await import('./transcription');
  const rawText = await transcribeRecording(wavBase64, settings, storage);
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
      getEnhancementPrompt(settings.styleMode, settings.enhancementLevel),
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
  };
}

export function getInitialStatus(): AppStatus {
  return createIdleStatus();
}
