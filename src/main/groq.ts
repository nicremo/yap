import { net, session } from 'electron';

import type { KeyValidationResult } from '../shared/types';

export const GROQ_ORIGIN = 'https://api.groq.com';
const API_BASE = `${GROQ_ORIGIN}/openai/v1`;

/* Requests go through Chromium's network stack (net.fetch) rather than Node's.
   That gets HTTP/2 with long-lived pooled connections, the system proxy and
   certificate settings, and lets a dictation open its connection while the
   user is still speaking (see prewarmGroq). */
type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
let fetchImpl: FetchLike = (url, init) => net.fetch(url, init);

/** Test seam: swaps the transport. */
export function setGroqTransport(transport: FetchLike): void {
  fetchImpl = transport;
}

export type GroqErrorKind = 'auth' | 'rate-limit' | 'network' | 'timeout' | 'server' | 'request';

export class GroqError extends Error {
  readonly kind: GroqErrorKind;
  readonly status?: number;
  readonly retryAfterMs?: number;

  constructor(kind: GroqErrorKind, message: string, status?: number, retryAfterMs?: number) {
    super(message);
    this.name = 'GroqError';
    this.kind = kind;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }

  get retryable(): boolean {
    return this.kind === 'network' || this.kind === 'server';
  }
}

let lastPrewarmAt = 0;

/**
 * Opens a TLS connection to Groq ahead of the first request. Called when the
 * hotkey goes down, so the handshake overlaps with the user speaking instead
 * of adding a round trip or three after they let go.
 */
export function prewarmGroq(): void {
  const now = Date.now();
  if (now - lastPrewarmAt < 2_000) {
    return;
  }
  lastPrewarmAt = now;
  try {
    session.defaultSession.preconnect({ url: GROQ_ORIGIN, numSockets: 1 });
  } catch {
    // Purely an optimisation.
  }
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

function extractErrorMessage(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } | string };
    if (typeof parsed.error === 'string') return parsed.error;
    if (parsed.error?.message) return parsed.error.message;
  } catch {
    // Not JSON.
  }
  return body.trim().slice(0, 300);
}

export function classifyHttpError(status: number, body: string, retryAfter: string | null): GroqError {
  const detail = extractErrorMessage(body);

  if (status === 401 || status === 403) {
    return new GroqError('auth', 'Groq rejected the API key. Check it in Engine settings.', status);
  }
  if (status === 429) {
    const retryAfterMs = parseRetryAfter(retryAfter);
    const wait = retryAfterMs !== undefined ? ` Try again in ${Math.max(1, Math.ceil(retryAfterMs / 1000))}s.` : '';
    return new GroqError('rate-limit', `Groq rate limit reached.${wait}`, status, retryAfterMs);
  }
  if (status === 413) {
    return new GroqError('request', 'The recording is too large for Groq (25 MB limit on the free tier).', status);
  }
  if (status >= 500) {
    return new GroqError('server', `Groq had a server error (${status}).${detail ? ` ${detail}` : ''}`, status);
  }
  return new GroqError('request', `Groq refused the request (${status}).${detail ? ` ${detail}` : ''}`, status);
}

function describeNetworkError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED|ENOTFOUND|ERR_NAME_NOT_RESOLVED/i.test(message)) {
    return 'No internet connection. Groq could not be reached.';
  }
  return `Groq could not be reached (${message}).`;
}

interface TimedRequest {
  path: string;
  apiKey: string;
  init: RequestInit;
  timeoutMs: number;
  signal?: AbortSignal;
}

/** Performs one request and returns the body, mapping every failure onto a GroqError. */
async function requestOnce({ path, apiKey, init, timeoutMs, signal }: TimedRequest): Promise<string> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const forwardAbort = () => controller.abort();
  signal?.addEventListener('abort', forwardAbort, { once: true });

  try {
    const response = await fetchImpl(`${API_BASE}${path}`, {
      ...init,
      headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
    const body = await response.text();
    if (!response.ok) {
      throw classifyHttpError(response.status, body, response.headers.get('retry-after'));
    }
    return body;
  } catch (error) {
    if (error instanceof GroqError) throw error;
    if (timedOut) {
      throw new GroqError('timeout', `Groq did not answer within ${Math.round(timeoutMs / 1000)}s.`);
    }
    if (signal?.aborted) {
      throw error;
    }
    throw new GroqError('network', describeNetworkError(error));
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', forwardAbort);
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** One retry for transient failures. A dictation is worth a second attempt, not a third. */
async function requestWithRetry(request: () => Promise<string>): Promise<string> {
  try {
    return await request();
  } catch (error) {
    if (!(error instanceof GroqError)) throw error;

    if (error.retryable) {
      await sleep(200);
      return request();
    }
    if (error.kind === 'rate-limit' && error.retryAfterMs !== undefined && error.retryAfterMs <= 2_000) {
      await sleep(error.retryAfterMs + 100);
      return request();
    }
    throw error;
  }
}

export interface TranscriptionRequest {
  apiKey: string;
  audio: Uint8Array;
  format: 'webm' | 'wav';
  model: string;
  language?: string;
  prompt?: string;
  signal?: AbortSignal;
}

export function buildTranscriptionForm(request: Omit<TranscriptionRequest, 'apiKey' | 'signal'>): FormData {
  const form = new FormData();
  const type = request.format === 'webm' ? 'audio/webm' : 'audio/wav';
  form.append('file', new Blob([new Uint8Array(request.audio)], { type }), `dictation.${request.format}`);
  form.append('model', request.model);
  form.append('response_format', 'text');
  form.append('temperature', '0');
  if (request.language) form.append('language', request.language);
  if (request.prompt) form.append('prompt', request.prompt);
  return form;
}

export async function transcribeWithGroq(request: TranscriptionRequest): Promise<string> {
  // Base allowance plus time for slow uplinks on long recordings.
  const timeoutMs = 15_000 + Math.ceil(request.audio.byteLength / 100_000) * 1_000;

  const body = await requestWithRetry(() =>
    requestOnce({
      path: '/audio/transcriptions',
      apiKey: request.apiKey,
      init: { method: 'POST', body: buildTranscriptionForm(request) },
      timeoutMs,
      signal: request.signal,
    }),
  );

  return body.trim();
}

export interface ChatRequest {
  apiKey: string;
  model: string;
  systemPrompt: string;
  userMessage: string;
  maxTokens: number;
  extraParams?: Record<string, unknown>;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface ChatResult {
  content: string;
  finishReason: string | null;
}

export function buildChatBody(request: Omit<ChatRequest, 'apiKey' | 'signal' | 'timeoutMs'>): string {
  return JSON.stringify({
    model: request.model,
    temperature: 0,
    max_completion_tokens: request.maxTokens,
    ...request.extraParams,
    messages: [
      { role: 'system', content: request.systemPrompt },
      { role: 'user', content: request.userMessage },
    ],
  });
}

export async function chatWithGroq(request: ChatRequest): Promise<ChatResult> {
  const body = await requestWithRetry(() =>
    requestOnce({
      path: '/chat/completions',
      apiKey: request.apiKey,
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: buildChatBody(request),
      },
      timeoutMs: request.timeoutMs ?? 10_000,
      signal: request.signal,
    }),
  );

  let payload: { choices?: Array<{ message?: { content?: string | null }; finish_reason?: string | null }> };
  try {
    payload = JSON.parse(body);
  } catch {
    throw new GroqError('server', 'Groq returned an unreadable response.');
  }

  const choice = payload.choices?.[0];
  return {
    content: choice?.message?.content ?? '',
    finishReason: choice?.finish_reason ?? null,
  };
}

export async function validateGroqKey(apiKey: string, requiredModel?: string): Promise<KeyValidationResult> {
  const trimmed = apiKey.trim();
  if (!trimmed) {
    return { valid: false, error: 'Paste your Groq API key first.' };
  }

  try {
    const body = await requestOnce({
      path: '/models',
      apiKey: trimmed,
      init: { method: 'GET' },
      timeoutMs: 10_000,
    });

    if (requiredModel) {
      let models: Array<{ id?: string }> = [];
      try {
        models = (JSON.parse(body) as { data?: Array<{ id?: string }> }).data ?? [];
      } catch {
        // The key authenticated, an odd body is not the user's problem.
      }
      if (models.length > 0 && !models.some((model) => model.id === requiredModel)) {
        return { valid: false, error: `This key has no access to ${requiredModel}.` };
      }
    }
    return { valid: true };
  } catch (error) {
    if (error instanceof GroqError && error.kind === 'auth') {
      return { valid: false, error: 'Groq does not accept this key. Copy it again from console.groq.com.' };
    }
    return { valid: false, error: error instanceof Error ? error.message : 'Validation failed.' };
  }
}
