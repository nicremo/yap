import type { CloudTranscriptionModel, LocalWhisperModel } from './types';

export const DEFAULT_CLOUD_MODEL: CloudTranscriptionModel = 'whisper-large-v3';
export const DEFAULT_LOCAL_MODEL: LocalWhisperModel = 'onnx-community/whisper-base';
export const DEFAULT_REWRITE_MODEL = 'openai/gpt-oss-20b';

export const CLOUD_MODELS: ReadonlyArray<{ id: CloudTranscriptionModel; label: string; note: string }> = [
  { id: 'whisper-large-v3', label: 'Whisper Large v3', note: 'Most accurate' },
  { id: 'whisper-large-v3-turbo', label: 'Whisper Large v3 Turbo', note: 'Fastest, slightly less accurate' },
];

export const LOCAL_MODELS: ReadonlyArray<{ id: LocalWhisperModel; label: string; size: string; note: string }> = [
  { id: 'onnx-community/whisper-base', label: 'Whisper Base', size: '140 MB', note: 'Fast, good for English' },
  { id: 'onnx-community/whisper-small', label: 'Whisper Small', size: '510 MB', note: 'Slower, much better for other languages' },
];

export interface RewriteModelOption {
  id: string;
  label: string;
  note: string;
  /** Extra chat completion parameters, e.g. to keep reasoning models from thinking out loud. */
  params?: Record<string, unknown>;
}

/* Groq production models only. Preview models can disappear without notice,
   which would turn every dictation into a raw-text fallback. */
export const REWRITE_MODELS: ReadonlyArray<RewriteModelOption> = [
  {
    id: 'openai/gpt-oss-20b',
    label: 'GPT-OSS 20B',
    note: 'Fastest, about 1000 tokens/s',
    params: { reasoning_effort: 'low', include_reasoning: false },
  },
  {
    id: 'openai/gpt-oss-120b',
    label: 'GPT-OSS 120B',
    note: 'Most capable, about 500 tokens/s',
    params: { reasoning_effort: 'low', include_reasoning: false },
  },
  { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B', note: 'About 280 tokens/s' },
  { id: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B', note: 'Lightweight, about 560 tokens/s' },
];

export function findRewriteModel(id: string): RewriteModelOption | undefined {
  return REWRITE_MODELS.find((model) => model.id === id);
}

export const LANGUAGES: ReadonlyArray<{ code: string; label: string }> = [
  { code: '', label: 'Auto-detect' },
  { code: 'de', label: 'Deutsch' },
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'Français' },
  { code: 'es', label: 'Español' },
  { code: 'it', label: 'Italiano' },
  { code: 'pt', label: 'Português' },
  { code: 'nl', label: 'Nederlands' },
  { code: 'pl', label: 'Polski' },
  { code: 'tr', label: 'Türkçe' },
  { code: 'sv', label: 'Svenska' },
  { code: 'da', label: 'Dansk' },
  { code: 'no', label: 'Norsk' },
  { code: 'fi', label: 'Suomi' },
  { code: 'cs', label: 'Čeština' },
  { code: 'uk', label: 'Українська' },
  { code: 'ru', label: 'Русский' },
  { code: 'ja', label: '日本語' },
  { code: 'zh', label: '中文' },
  { code: 'ko', label: '한국어' },
];

export const GROQ_CONSOLE_URL = 'https://console.groq.com/keys';
