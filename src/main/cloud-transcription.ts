import type { CloudTranscriptionModel } from '../shared/types';

const DEFAULT_BASE_URL = 'https://api.openai.com';
const TRANSCRIPTION_TIMEOUT_MS = 30_000;
const TEST_CONNECTION_TIMEOUT_MS = 10_000;

function buildTranscriptionUrl(baseUrl: string): string {
  const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  return `${base}/v1/audio/transcriptions`;
}

function buildModelsUrl(baseUrl: string): string {
  const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  return `${base}/v1/models`;
}

type CloudErrorReason =
  | { kind: 'network'; cause: string }
  | { kind: 'auth'; cause: string }
  | { kind: 'quota'; cause: string }
  | { kind: 'server'; statusCode: number; cause: string };

export class CloudTranscriptionError extends Error {
  readonly reason: CloudErrorReason;

  constructor(reason: CloudErrorReason) {
    super(formatCloudErrorMessage(reason));
    this.reason = reason;
  }

  get isRetryable(): boolean {
    return this.reason.kind === 'network' || this.reason.kind === 'server';
  }
}

function formatCloudErrorMessage(reason: CloudErrorReason): string {
  switch (reason.kind) {
    case 'network':
      return `Cloud transcription unavailable: ${reason.cause}`;
    case 'auth':
      return `Invalid OpenAI API key: ${reason.cause}`;
    case 'quota':
      return `OpenAI quota exceeded: ${reason.cause}`;
    case 'server':
      return `OpenAI returned an error (${reason.statusCode}): ${reason.cause}`;
  }
}

function classifyHttpError(status: number, body: string): CloudErrorReason {
  if (status === 401) {
    return { kind: 'auth', cause: body || 'Authentication failed.' };
  }

  if (status === 429) {
    return { kind: 'quota', cause: body || 'Rate limit or billing issue.' };
  }

  return { kind: 'server', statusCode: status, cause: body || 'Unexpected server error.' };
}

function classifyFetchError(error: unknown): CloudErrorReason {
  if (error instanceof Error) {
    if (error.name === 'AbortError') {
      return { kind: 'network', cause: 'Request timed out.' };
    }

    const nested = (error as Error & { cause?: { code?: string } }).cause;
    if (nested?.code === 'ECONNREFUSED' || nested?.code === 'ENOTFOUND') {
      return { kind: 'network', cause: 'Could not reach OpenAI servers.' };
    }

    if (error.message === 'fetch failed') {
      return { kind: 'network', cause: 'Network request failed.' };
    }
  }

  return { kind: 'network', cause: 'An unknown network error occurred.' };
}

function validateWavBuffer(buffer: Buffer): void {
  if (buffer.length < 44) {
    throw new Error('WAV buffer is too small to contain a valid header.');
  }

  const header = buffer.subarray(0, 4).toString('ascii');
  if (header !== 'RIFF') {
    throw new Error(`Expected RIFF header, got "${header}".`);
  }
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export async function transcribeWithCloud(
  wavBase64: string,
  apiKey: string,
  model: CloudTranscriptionModel,
  baseUrl: string = DEFAULT_BASE_URL,
  language?: string,
): Promise<string> {
  if (!apiKey) {
    throw new CloudTranscriptionError({ kind: 'auth', cause: 'No API key provided.' });
  }

  const wavBuffer = Buffer.from(wavBase64, 'base64');
  validateWavBuffer(wavBuffer);

  const blob = new Blob([wavBuffer], { type: 'audio/wav' });
  const form = new FormData();
  form.append('file', blob, 'recording.wav');
  form.append('model', model);
  form.append('response_format', 'text');
  if (language) {
    form.append('language', language);
  }

  let response: Response;

  try {
    response = await fetchWithTimeout(
      buildTranscriptionUrl(baseUrl),
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
      },
      TRANSCRIPTION_TIMEOUT_MS,
    );
  } catch (error) {
    throw new CloudTranscriptionError(classifyFetchError(error));
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new CloudTranscriptionError(classifyHttpError(response.status, body));
  }

  const text = await response.text();
  return text.trim();
}

export async function testCloudConnection(apiKey: string, baseUrl: string = DEFAULT_BASE_URL): Promise<{ valid: boolean; error?: string }> {
  if (!apiKey) {
    return { valid: false, error: 'No API key provided.' };
  }

  try {
    const response = await fetchWithTimeout(
      buildModelsUrl(baseUrl),
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}` },
      },
      TEST_CONNECTION_TIMEOUT_MS,
    );

    if (response.ok) {
      return { valid: true };
    }

    if (response.status === 401) {
      return { valid: false, error: 'Invalid API key.' };
    }

    return { valid: false, error: `OpenAI returned status ${response.status}.` };
  } catch {
    return { valid: false, error: 'Could not reach OpenAI servers.' };
  }
}
