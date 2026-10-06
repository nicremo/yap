import type { CloudTranscriptionModel, LocalWhisperModel } from './types';

export const DEFAULT_CLOUD_MODEL: CloudTranscriptionModel = 'whisper-large-v3';
export const DEFAULT_LOCAL_MODEL: LocalWhisperModel = 'onnx-community/whisper-base';
export const DEFAULT_REWRITE_MODEL = 'openai/gpt-oss-20b';

/* Model notes ("Most accurate") live with the other texts, under modelNotes. */

export const CLOUD_MODELS: ReadonlyArray<{ id: CloudTranscriptionModel; label: string }> = [
  { id: 'whisper-large-v3', label: 'Whisper Large v3' },
  { id: 'whisper-large-v3-turbo', label: 'Whisper Large v3 Turbo' },
];

export const LOCAL_MODELS: ReadonlyArray<{ id: LocalWhisperModel; label: string; size: string }> = [
  { id: 'onnx-community/whisper-base', label: 'Whisper Base', size: '140 MB' },
  { id: 'onnx-community/whisper-small', label: 'Whisper Small', size: '510 MB' },
];

export interface RewriteModelOption {
  id: string;
  label: string;
  /** Groq preview model: can change or disappear at short notice. */
  preview?: boolean;
  /** Extra chat completion parameters, e.g. to keep reasoning models from thinking out loud. */
  params?: Record<string, unknown>;
}

/* The rewrite models Yap knows how to drive, with the parameters each one
   needs. Which of them a key can actually use is checked against Groq's
   model list when the key is saved and then once a day; this list is the
   offline fallback. A model that turns out to be gone mid-session is
   replaced by the default for that dictation. */
export const REWRITE_MODELS: ReadonlyArray<RewriteModelOption> = [
  {
    id: 'openai/gpt-oss-20b',
    label: 'GPT-OSS 20B',
    params: { reasoning_effort: 'low', include_reasoning: false },
  },
  {
    id: 'openai/gpt-oss-120b',
    label: 'GPT-OSS 120B',
    params: { reasoning_effort: 'low', include_reasoning: false },
  },
  {
    id: 'qwen/qwen3.8-27b',
    label: 'Qwen3.8 27B',
    preview: true,
    // Instruct mode: a faithful rewrite needs no thinking.
    params: { reasoning_effort: 'none' },
  },
];

export function findRewriteModel(id: string): RewriteModelOption | undefined {
  return REWRITE_MODELS.find((model) => model.id === id);
}

export const LANGUAGES: ReadonlyArray<{ code: string; label: string }> = [
  // Empty means auto-detect; the UI words it in its language.
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
