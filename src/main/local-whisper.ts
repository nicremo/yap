import path from 'node:path';

import { formatNumber } from '../shared/i18n';
import type { LocalWhisperModel } from '../shared/types';
import { currentLocale, t } from './i18n';
import { pathExists } from './storage';

/* The encoder stays full precision because quantising it costs Whisper a lot
   of accuracy. The decoder runs once per token, so 8-bit there buys most of
   the speed for very little quality, and the download shrinks accordingly. */
const DTYPE = { encoder_model: 'fp32', decoder_model_merged: 'q8' } as const;
const REQUIRED_FILES = ['config.json', 'onnx/encoder_model.onnx', 'onnx/decoder_model_merged_quantized.onnx'];

type Transcriber = (
  audio: Float32Array,
  options?: Record<string, unknown>,
) => Promise<{ text?: string } | Array<{ text?: string }>>;

let loaded: { key: string; promise: Promise<Transcriber> } | null = null;

export async function isLocalModelReady(modelsDirectory: string, model: LocalWhisperModel): Promise<boolean> {
  const checks = await Promise.all(
    REQUIRED_FILES.map((file) => pathExists(path.join(modelsDirectory, model, file))),
  );
  return checks.every(Boolean);
}

export interface DownloadProgress {
  progress: number;
  detail: string;
}

async function createTranscriber(
  modelsDirectory: string,
  model: LocalWhisperModel,
  onProgress?: (progress: DownloadProgress) => void,
): Promise<Transcriber> {
  // Loaded on demand: the library and its native runtime are large and only
  // needed when someone actually transcribes locally.
  const { env, pipeline } = await import('@huggingface/transformers');
  env.allowRemoteModels = true;
  env.allowLocalModels = true;
  env.cacheDir = modelsDirectory;
  env.localModelPath = modelsDirectory;

  const fileProgress = new Map<string, { loaded: number; total: number }>();

  const transcriber = await pipeline('automatic-speech-recognition', model, {
    dtype: DTYPE,
    device: 'cpu',
    progress_callback: (event: { status?: string; file?: string; loaded?: number; total?: number }) => {
      if (!onProgress || event.status !== 'progress' || !event.file || !event.total) return;
      fileProgress.set(event.file, { loaded: event.loaded ?? 0, total: event.total });
      let loadedBytes = 0;
      let totalBytes = 0;
      for (const entry of fileProgress.values()) {
        loadedBytes += entry.loaded;
        totalBytes += entry.total;
      }
      const megabytes = (value: number) => formatNumber(Math.round(value / 1_000_000), currentLocale());
      onProgress({
        progress: totalBytes > 0 ? Math.min(1, loadedBytes / totalBytes) : 0,
        detail: t().local.progress(megabytes(loadedBytes), megabytes(totalBytes)),
      });
    },
  } as Record<string, unknown>);

  return transcriber as unknown as Transcriber;
}

function getTranscriber(
  modelsDirectory: string,
  model: LocalWhisperModel,
  onProgress?: (progress: DownloadProgress) => void,
): Promise<Transcriber> {
  const key = `${modelsDirectory}:${model}`;
  if (loaded?.key === key) {
    return loaded.promise;
  }

  const promise = createTranscriber(modelsDirectory, model, onProgress);
  loaded = { key, promise };
  // A failed load must not be cached, or every later attempt fails instantly.
  promise.catch(() => {
    if (loaded?.promise === promise) loaded = null;
  });
  return promise;
}

/** Downloads (if needed) and loads the model, so the first dictation is not the slow one. */
export async function prepareLocalModel(
  modelsDirectory: string,
  model: LocalWhisperModel,
  onProgress?: (progress: DownloadProgress) => void,
): Promise<void> {
  await getTranscriber(modelsDirectory, model, onProgress);
}

export function decodePcm16Wav(buffer: Uint8Array): Float32Array {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const tag = (offset: number) =>
    String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));

  if (buffer.byteLength < 44 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') {
    throw new Error(t().local.invalidWav);
  }

  let offset = 12;
  let format = 0;
  let channels = 0;
  let bitsPerSample = 0;
  let dataOffset = 0;
  let dataSize = 0;

  while (offset + 8 <= view.byteLength) {
    const chunkId = tag(offset);
    const chunkSize = view.getUint32(offset + 4, true);
    const chunkData = offset + 8;

    if (chunkId === 'fmt ') {
      format = view.getUint16(chunkData, true);
      channels = view.getUint16(chunkData + 2, true);
      bitsPerSample = view.getUint16(chunkData + 14, true);
    } else if (chunkId === 'data') {
      dataOffset = chunkData;
      dataSize = Math.min(chunkSize, view.byteLength - chunkData);
      break;
    }
    offset += 8 + chunkSize + (chunkSize % 2);
  }

  if (format !== 1 || channels !== 1 || bitsPerSample !== 16 || dataOffset === 0) {
    throw new Error(t().local.unsupportedWav);
  }

  const samples = new Float32Array(Math.floor(dataSize / 2));
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = view.getInt16(dataOffset + index * 2, true) / 0x8000;
  }
  return samples;
}

export async function transcribeLocally(options: {
  wav: Uint8Array;
  modelsDirectory: string;
  model: LocalWhisperModel;
  language: string;
}): Promise<string> {
  const transcriber = await getTranscriber(options.modelsDirectory, options.model);
  const audio = decodePcm16Wav(options.wav);
  const result = await transcriber(audio, {
    return_timestamps: false,
    // Chunking only kicks in for recordings longer than one Whisper window.
    chunk_length_s: 30,
    stride_length_s: 5,
    task: 'transcribe',
    ...(options.language ? { language: options.language } : {}),
  });

  const output = Array.isArray(result) ? result.map((part) => part.text ?? '').join(' ') : result.text ?? '';
  return output.trim();
}
