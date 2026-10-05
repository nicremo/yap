import type {
  AppSettings,
  CorrectionEntry,
  DictionaryEntry,
  EnhancementLevel,
  StyleMode,
} from '../../shared/types';
import { buildDictionaryContext, buildWhisperPrompt } from '../dictionary';
import { GroqError, transcribeWithGroq } from '../groq';
import { transcribeLocally } from '../local-whisper';
import { rewriteText } from '../rewrite';
import { getGroqApiKey } from '../secrets';
import { getStoragePaths } from '../storage';

export class NothingHeardError extends Error {
  constructor() {
    super('Nothing was heard. Hold the key a little longer while you speak.');
    this.name = 'NothingHeardError';
  }
}

/** Below this the recording is silence, whatever Whisper makes of it. */
export const SILENCE_PEAK_RMS = 0.004;
/** At or above this the recording almost certainly contains speech. Below it,
    a stock phrase is far more likely a Whisper hallucination than speech. */
export const SPEECH_PEAK_RMS = 0.03;

/* What Whisper says when it hears (almost) nothing. It learned these from
   subtitled videos, so they come out on quiet recordings with confidence. */
const HALLUCINATIONS = new Set([
  'thank you',
  'thank you very much',
  'thanks for watching',
  'thank you for watching',
  'you',
  'bye',
  'vielen dank',
  'danke',
  'danke schön',
  'danke fürs zuschauen',
  'tschüss',
  'bis zum nächsten mal',
  'untertitel im auftrag des zdf 2017',
  'untertitel im auftrag des zdf für funk 2017',
  'untertitel der amaraorg-community',
  'untertitelung des zdf 2020',
  'sous-titres réalisés par la communauté damaraorg',
  'merci',
  'gracias',
]);

function normalizeForComparison(text: string): string {
  return text
    .toLowerCase()
    .replace(/[.,!?;:"'„“”«»()…]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isLikelyHallucination(text: string, peakRms: number): boolean {
  if (peakRms >= SPEECH_PEAK_RMS) return false;
  return HALLUCINATIONS.has(normalizeForComparison(text));
}

export interface AudioInput {
  wav: Uint8Array;
  opus: Uint8Array | null;
}

export interface TranscriptionOutcome {
  text: string;
  source: 'cloud' | 'local';
  uploadBytes: number | null;
}

export async function transcribe(
  settings: AppSettings,
  audio: AudioInput,
  dictionary: DictionaryEntry[],
  corrections: CorrectionEntry[],
  options: { expectSpeech?: boolean } = {},
): Promise<TranscriptionOutcome> {
  if (settings.transcriptionMode === 'local') {
    const text = await transcribeLocally({
      wav: audio.wav,
      modelsDirectory: getStoragePaths(settings).models,
      model: settings.localModel,
      language: settings.language,
    });
    return { text, source: 'local', uploadBytes: null };
  }

  const apiKey = getGroqApiKey(settings);
  if (!apiKey) {
    throw new Error('No Groq API key is set. Add one in Engine settings.');
  }

  const prompt = buildWhisperPrompt(dictionary, corrections) || undefined;
  const language = settings.language || undefined;
  const useOpus = audio.opus !== null && audio.opus.byteLength > 0;
  const payload = useOpus ? audio.opus! : audio.wav;

  try {
    const text = await transcribeWithGroq({
      apiKey,
      audio: payload,
      format: useOpus ? 'webm' : 'wav',
      model: settings.cloudModel,
      language,
      prompt,
    });
    // An empty answer for audio that clearly has speech in it points at the
    // compressed file, not the speaker. The WAV settles it.
    if (useOpus && !text.trim() && options.expectSpeech) {
      console.warn('[yap] empty transcript for an Opus upload with speech, retrying with WAV');
      const retry = await transcribeWithGroq({ apiKey, audio: audio.wav, format: 'wav', model: settings.cloudModel, language, prompt });
      return { text: retry, source: 'cloud', uploadBytes: payload.byteLength + audio.wav.byteLength };
    }
    return { text, source: 'cloud', uploadBytes: payload.byteLength };
  } catch (error) {
    // The compressed upload is an optimisation. If Groq cannot read it, the
    // WAV always works.
    if (useOpus && error instanceof GroqError && error.kind === 'request' && error.status === 400) {
      console.warn('[yap] Groq refused the Opus upload, retrying with WAV:', error.message);
      const text = await transcribeWithGroq({
        apiKey,
        audio: audio.wav,
        format: 'wav',
        model: settings.cloudModel,
        language,
        prompt,
      });
      return { text, source: 'cloud', uploadBytes: audio.wav.byteLength };
    }
    throw error;
  }
}

export interface PolishOutcome {
  text: string;
  /** Null when enhancement did not run. */
  durationMs: number | null;
  notice?: string;
}

export async function polish(options: {
  settings: AppSettings;
  text: string;
  styleMode: StyleMode;
  enhancementLevel: EnhancementLevel;
  dictionary: DictionaryEntry[];
  corrections: CorrectionEntry[];
}): Promise<PolishOutcome> {
  const { settings, text } = options;
  if (!settings.enhancementEnabled || !text) {
    return { text, durationMs: null };
  }

  const apiKey = getGroqApiKey(settings);
  if (!apiKey) {
    return { text, durationMs: null };
  }

  const startedAt = Date.now();
  const result = await rewriteText({
    apiKey,
    model: settings.rewriteModel,
    text,
    style: options.styleMode,
    level: options.enhancementLevel,
    voice: settings.customPlusVoice,
    language: settings.language,
    dictionaryContext: buildDictionaryContext(options.dictionary, options.corrections),
  });

  return { text: result.text, durationMs: Date.now() - startedAt, notice: result.notice };
}
