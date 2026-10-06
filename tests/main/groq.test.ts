import { afterEach, describe, expect, it } from 'vitest';

import {
  buildChatBody,
  buildTranscriptionForm,
  chatWithGroq,
  classifyHttpError,
  GroqError,
  isModelUnavailableError,
  listGroqModels,
  setGroqTransport,
  transcribeWithGroq,
  validateGroqKey,
} from '../../src/main/groq';
import { findRewriteModel } from '../../src/shared/models';

interface Call {
  url: string;
  init: RequestInit;
}

function transport(responses: Array<() => Response | Promise<Response>>): { calls: Call[] } {
  const calls: Call[] = [];
  setGroqTransport(async (url, init) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error('unexpected request');
    return next();
  });
  return { calls };
}

afterEach(() => {
  setGroqTransport(async () => {
    throw new Error('transport not configured');
  });
});

describe('request building', () => {
  it('uploads Opus as webm with the language and the dictionary prompt', async () => {
    const form = buildTranscriptionForm({
      audio: new Uint8Array([1, 2, 3]),
      format: 'webm',
      model: 'whisper-large-v3',
      language: 'de',
      prompt: 'Supabase, Kubernetes',
    });

    const file = form.get('file') as File;
    expect(file.name).toBe('dictation.webm');
    expect(file.type).toBe('audio/webm');
    expect(file.size).toBe(3);
    expect(form.get('model')).toBe('whisper-large-v3');
    expect(form.get('response_format')).toBe('text');
    expect(form.get('language')).toBe('de');
    expect(form.get('prompt')).toBe('Supabase, Kubernetes');
  });

  it('leaves out empty optional fields', () => {
    const form = buildTranscriptionForm({ audio: new Uint8Array([1]), format: 'wav', model: 'whisper-large-v3' });
    expect((form.get('file') as File).name).toBe('dictation.wav');
    expect(form.has('language')).toBe(false);
    expect(form.has('prompt')).toBe(false);
  });

  it('keeps reasoning models from thinking out loud', () => {
    const body = JSON.parse(
      buildChatBody({
        model: 'openai/gpt-oss-20b',
        systemPrompt: 'system',
        userMessage: 'user',
        maxTokens: 900,
        extraParams: findRewriteModel('openai/gpt-oss-20b')?.params,
      }),
    );

    expect(body.reasoning_effort).toBe('low');
    expect(body.include_reasoning).toBe(false);
    expect(body.max_completion_tokens).toBe(900);
    expect(body.temperature).toBe(0);
    expect(body.messages).toEqual([
      { role: 'system', content: 'system' },
      { role: 'user', content: 'user' },
    ]);
  });

  it('sends no reasoning parameters to non-reasoning models', () => {
    const body = JSON.parse(
      buildChatBody({
        model: 'llama-3.3-70b-versatile',
        systemPrompt: 's',
        userMessage: 'u',
        maxTokens: 100,
        extraParams: findRewriteModel('llama-3.3-70b-versatile')?.params,
      }),
    );
    expect(body).not.toHaveProperty('reasoning_effort');
  });
});

describe('error classification', () => {
  it('maps the status codes onto actionable kinds', () => {
    expect(classifyHttpError(401, '', null).kind).toBe('auth');
    expect(classifyHttpError(413, '', null).kind).toBe('request');
    expect(classifyHttpError(500, '', null).retryable).toBe(true);
    expect(classifyHttpError(400, '{"error":{"message":"bad file"}}', null).message).toContain('bad file');

    const limited = classifyHttpError(429, '', '7');
    expect(limited.kind).toBe('rate-limit');
    expect(limited.retryAfterMs).toBe(7_000);
    expect(limited.message).toContain('7s');
  });

  it('recognises a model that is gone or not available to the key', () => {
    const notFound = classifyHttpError(
      404,
      '{"error":{"message":"The model `qwen/qwen3.8-27b` does not exist","type":"invalid_request_error","code":"model_not_found"}}',
      null,
    );
    expect(notFound.code).toBe('model_not_found');
    expect(isModelUnavailableError(notFound)).toBe(true);
    expect(isModelUnavailableError(classifyHttpError(400, '{"error":{"code":"model_decommissioned"}}', null))).toBe(true);
    expect(isModelUnavailableError(classifyHttpError(400, '{"error":{"code":"invalid_value"}}', null))).toBe(false);
    expect(isModelUnavailableError(classifyHttpError(500, '', null))).toBe(false);
    expect(isModelUnavailableError(new Error('x'))).toBe(false);
  });
});

describe('transcribeWithGroq', () => {
  const request = { apiKey: 'gsk_test', audio: new Uint8Array([1, 2]), format: 'webm' as const, model: 'whisper-large-v3' };

  it('returns the trimmed transcript and authenticates', async () => {
    const { calls } = transport([() => new Response('  Hallo Welt \n', { status: 200 })]);
    await expect(transcribeWithGroq(request)).resolves.toBe('Hallo Welt');
    expect(calls[0].url).toBe('https://api.groq.com/openai/v1/audio/transcriptions');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer gsk_test');
  });

  it('retries a server error once', async () => {
    const { calls } = transport([
      () => new Response('overloaded', { status: 503 }),
      () => new Response('ok', { status: 200 }),
    ]);
    await expect(transcribeWithGroq(request)).resolves.toBe('ok');
    expect(calls).toHaveLength(2);
  });

  it('retries a dropped connection once', async () => {
    const { calls } = transport([
      () => Promise.reject(new TypeError('net::ERR_CONNECTION_RESET')),
      () => new Response('ok', { status: 200 }),
    ]);
    await expect(transcribeWithGroq(request)).resolves.toBe('ok');
    expect(calls).toHaveLength(2);
  });

  it('does not retry a rejected key', async () => {
    const { calls } = transport([() => new Response('invalid', { status: 401 })]);
    await expect(transcribeWithGroq(request)).rejects.toMatchObject({ kind: 'auth' });
    expect(calls).toHaveLength(1);
  });

  it('gives up after the second failure', async () => {
    transport([
      () => new Response('down', { status: 502 }),
      () => new Response('down', { status: 502 }),
    ]);
    await expect(transcribeWithGroq(request)).rejects.toBeInstanceOf(GroqError);
  });
});

describe('chatWithGroq', () => {
  it('returns the content and the finish reason', async () => {
    transport([
      () =>
        new Response(JSON.stringify({ choices: [{ message: { content: 'Sauber.' }, finish_reason: 'stop' }] }), {
          status: 200,
        }),
    ]);
    await expect(
      chatWithGroq({ apiKey: 'k', model: 'openai/gpt-oss-20b', systemPrompt: 's', userMessage: 'u', maxTokens: 10 }),
    ).resolves.toEqual({ content: 'Sauber.', finishReason: 'stop' });
  });
});

describe('validateGroqKey', () => {
  it('accepts a key that lists the transcription model and returns the model list', async () => {
    transport([() => new Response(JSON.stringify({ data: [{ id: 'whisper-large-v3' }, { id: 'openai/gpt-oss-20b' }] }), { status: 200 })]);
    await expect(validateGroqKey('gsk_ok', 'whisper-large-v3')).resolves.toEqual({
      valid: true,
      models: ['whisper-large-v3', 'openai/gpt-oss-20b'],
    });
  });

  it('refuses a key without the transcription model', async () => {
    transport([() => new Response(JSON.stringify({ data: [{ id: 'openai/gpt-oss-20b' }] }), { status: 200 })]);
    const result = await validateGroqKey('gsk_ok', 'whisper-large-v3');
    expect(result).toMatchObject({ valid: false, error: expect.stringContaining('whisper-large-v3') });
  });

  it('explains a rejected key', async () => {
    transport([() => new Response('nope', { status: 401 })]);
    const result = await validateGroqKey('gsk_bad');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('does not accept');
  });

  it('lists the models with the key', async () => {
    const { calls } = transport([() => new Response(JSON.stringify({ data: [{ id: 'a' }, { id: 2 }, {}] }), { status: 200 })]);
    await expect(listGroqModels('gsk_ok')).resolves.toEqual(['a']);
    expect(calls[0].url).toMatch(/\/models$/);
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer gsk_ok');
  });

  it('refuses an empty key without a request', async () => {
    const { calls } = transport([]);
    expect((await validateGroqKey('   ')).valid).toBe(false);
    expect(calls).toHaveLength(0);
  });
});
