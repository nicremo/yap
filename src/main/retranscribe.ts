import type { AppRule, AppSettings, AppStatus, CorrectionEntry, DictionaryEntry, HistoryEntry, RetranscribeMode } from '../shared/types';
import { readAudioRecording } from './audio-store';
import { runRewrite, runTranscription } from './dictation';
import { resolveStyleForApp } from './app-rules';
import { updateHistoryEntry } from './history';

interface RetranscribeOptions {
  entry: HistoryEntry;
  mode: RetranscribeMode;
  settings: AppSettings;
  dictionary: DictionaryEntry[];
  corrections: CorrectionEntry[];
  appRules: AppRule[];
  setStatus: (status: AppStatus) => void;
}

export async function retranscribeEntry(options: RetranscribeOptions): Promise<HistoryEntry[]> {
  const { entry, mode, settings, dictionary, corrections, appRules, setStatus } = options;

  if (!entry.audioFilename) {
    throw new Error('This dictation no longer has an audio recording. The 7-day retention window has elapsed.');
  }

  const wavBase64 = await readAudioRecording(settings, entry.audioFilename).catch(() => null);
  if (!wavBase64) {
    throw new Error('The stored audio file is missing on disk.');
  }

  setStatus({
    phase: 'transcribing',
    title: 'Retranscribing',
    detail: mode === 'transcribe-and-stylize'
      ? 'Rerunning the full transcription + rewrite pipeline.'
      : 'Rerunning transcription only.',
  });

  try {
    const transcription = await runTranscription({
      wavBase64,
      settings,
      dictionary,
      corrections,
      setStatus,
    });

    if (!transcription.text) {
      const { entries } = await updateHistoryEntry(entry.id, {
        status: 'transcription-failed',
        errorMessage: 'No speech detected in the recording.',
      });
      setStatus({ phase: 'error', title: 'Nothing heard', detail: 'OpenWhisp did not detect enough speech to transcribe.' });
      return entries;
    }

    if (mode === 'transcribe-only') {
      const { entries } = await updateHistoryEntry(entry.id, {
        rawText: transcription.text,
        finalText: transcription.text,
        transcriptionSource: transcription.source,
        status: 'success',
        errorMessage: undefined,
      });
      setStatus({
        phase: 'done',
        title: 'Retranscribed',
        detail: 'Raw transcription updated. Copy from history to use it.',
        preview: transcription.text,
        rawText: transcription.text,
      });
      return entries;
    }

    // History entries do not store bundleIdentifier, so app-rule lookup is skipped:
    // retranscription falls back to the user's current default style + enhancement.
    const resolved = resolveStyleForApp(
      undefined,
      appRules,
      settings.styleMode,
      settings.enhancementLevel,
    );

    const rewrite = await runRewrite({
      rawText: transcription.text,
      settings,
      styleMode: resolved.styleMode,
      enhancementLevel: resolved.enhancementLevel,
      dictionary,
      corrections,
      setStatus,
    });

    const { entries } = await updateHistoryEntry(entry.id, {
      rawText: transcription.text,
      finalText: rewrite.usedFallback ? transcription.text : rewrite.finalText,
      transcriptionSource: transcription.source,
      styleMode: resolved.styleMode,
      enhancementLevel: resolved.enhancementLevel,
      status: 'success',
      errorMessage: rewrite.usedFallback ? 'Rewrite model was unavailable. Raw transcription kept as final text.' : undefined,
    });

    setStatus({
      phase: 'done',
      title: 'Retranscribed',
      detail: rewrite.usedFallback
        ? 'Transcription updated. Rewrite was skipped because the model was unavailable.'
        : 'Transcription and rewrite updated.',
      preview: rewrite.finalText,
      rawText: transcription.text,
    });
    return entries;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Retranscription failed.';
    const { entries } = await updateHistoryEntry(entry.id, {
      status: 'transcription-failed',
      errorMessage: message,
    });
    setStatus({ phase: 'error', title: 'Retranscription failed', detail: message });
    return entries;
  }
}
