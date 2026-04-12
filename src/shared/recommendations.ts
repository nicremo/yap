import type { CloudTranscriptionModel } from './types';

export const RECOMMENDED_WHISPER_MODEL = 'onnx-community/whisper-base';
export const RECOMMENDED_WHISPER_LABEL = 'Whisper Base (Multilingual)';
export const RECOMMENDED_TEXT_MODEL = 'qwen3.5:2b';
export const RECOMMENDED_CLOUD_MODEL: CloudTranscriptionModel = 'whisper-large-v3';

export const CLOUD_MODELS = [
  { id: 'whisper-large-v3' as const, label: 'Whisper Large v3', price: '$0.0002/min' },
  { id: 'whisper-large-v3-turbo' as const, label: 'Whisper Large v3 Turbo', price: '$0.0002/min' },
  { id: 'gpt-4o-mini-transcribe' as const, label: 'GPT-4o Mini Transcribe', price: '$0.003/min' },
  { id: 'gpt-4o-transcribe' as const, label: 'GPT-4o Transcribe', price: '$0.006/min' },
  { id: 'whisper-1' as const, label: 'Whisper 1', price: '$0.006/min' },
  { id: 'distil-whisper-large-v3-en' as const, label: 'Distil Whisper v3 (EN only)', price: '$0.0001/min' },
] satisfies ReadonlyArray<{ id: CloudTranscriptionModel; label: string; price: string }>;
