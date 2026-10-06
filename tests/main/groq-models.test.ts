import { beforeEach, describe, expect, it, vi } from 'vitest';

const stored = vi.hoisted(() => ({ files: new Map<string, unknown>() }));

vi.mock('../../src/main/json-file', () => ({
  readJsonFile: async (file: string) => stored.files.get(file) ?? null,
  writeJsonFile: async (file: string, value: unknown) => {
    stored.files.set(file, value);
  },
}));

import { setGroqTransport } from '../../src/main/groq';
import {
  markRewriteModelUnavailable,
  MODEL_LIST_MAX_AGE_MS,
  offeredRewriteModelIds,
  refreshGroqModelList,
  resetGroqModelsForTests,
  resolveRewriteModel,
  storeGroqModelList,
} from '../../src/main/groq-models';
import { rewriteText } from '../../src/main/rewrite';

const ALL = ['openai/gpt-oss-20b', 'openai/gpt-oss-120b', 'qwen/qwen3.8-27b'];

beforeEach(() => {
  stored.files.clear();
  resetGroqModelsForTests();
});

describe('offered rewrite models', () => {
  it('offers the whole catalogue while nothing is known about the key', () => {
    expect(offeredRewriteModelIds()).toEqual(ALL);
  });

  it('offers only what Groq lists for the key', async () => {
    await storeGroqModelList(['whisper-large-v3', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b', 'something-else']);
    expect(offeredRewriteModelIds()).toEqual(['openai/gpt-oss-20b', 'qwen/qwen3.8-27b']);
    expect(resolveRewriteModel('openai/gpt-oss-120b')).toBe('openai/gpt-oss-20b');
    expect(resolveRewriteModel('qwen/qwen3.8-27b')).toBe('qwen/qwen3.8-27b');
  });

  it('ignores an empty list instead of offering nothing', async () => {
    await storeGroqModelList([]);
    expect(offeredRewriteModelIds()).toEqual(ALL);
  });

  it('drops a model that failed in this session, and reports that once', () => {
    expect(markRewriteModelUnavailable('qwen/qwen3.8-27b')).toBe(true);
    expect(markRewriteModelUnavailable('qwen/qwen3.8-27b')).toBe(false);
    expect(offeredRewriteModelIds()).not.toContain('qwen/qwen3.8-27b');
    expect(resolveRewriteModel('qwen/qwen3.8-27b')).toBe('openai/gpt-oss-20b');
  });

  it('trusts a fresh list over an earlier failure', async () => {
    markRewriteModelUnavailable('qwen/qwen3.8-27b');
    await storeGroqModelList(ALL);
    expect(resolveRewriteModel('qwen/qwen3.8-27b')).toBe('qwen/qwen3.8-27b');
  });
});

describe('refreshGroqModelList', () => {
  it('asks Groq only when the stored list is older than a day', async () => {
    let requests = 0;
    setGroqTransport(async () => {
      requests += 1;
      return new Response(JSON.stringify({ data: [{ id: 'openai/gpt-oss-20b' }] }), { status: 200 });
    });
    const now = Date.parse('2026-10-06T08:00:00Z');

    await refreshGroqModelList('gsk', now);
    await refreshGroqModelList('gsk', now + 60_000);
    expect(requests).toBe(1);

    await refreshGroqModelList('gsk', now + MODEL_LIST_MAX_AGE_MS + 1);
    expect(requests).toBe(2);
    expect(offeredRewriteModelIds()).toEqual(['openai/gpt-oss-20b']);
  });
});

describe('rewriteText with a model that is gone', () => {
  const input = {
    apiKey: 'gsk',
    model: 'qwen/qwen3.8-27b',
    text: 'hallo welt',
    style: 'conversation' as const,
    level: 'medium' as const,
    voice: 'conversation' as const,
    language: 'de',
    dictionaryContext: '',
  };

  function groq(handler: (model: string) => Response) {
    const models: string[] = [];
    setGroqTransport(async (_url, init) => {
      const body = JSON.parse(String(init.body)) as { model: string };
      models.push(body.model);
      return handler(body.model);
    });
    return models;
  }

  const ok = (content: string) =>
    new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }), { status: 200 });
  const gone = () =>
    new Response(JSON.stringify({ error: { message: 'gone', code: 'model_not_found' } }), { status: 404 });

  it('polishes with the default model and says so once', async () => {
    const models = groq((model) => (model === 'qwen/qwen3.8-27b' ? gone() : ok('Hallo Welt.')));

    const first = await rewriteText(input);
    expect(models).toEqual(['qwen/qwen3.8-27b', 'openai/gpt-oss-20b']);
    expect(first).toMatchObject({ text: 'Hallo Welt.', model: 'openai/gpt-oss-20b', usedFallback: false });
    expect(first.notice).toContain('Qwen3.8 27B is not available');

    const second = await rewriteText(input);
    expect(models).toEqual(['qwen/qwen3.8-27b', 'openai/gpt-oss-20b', 'openai/gpt-oss-20b']);
    expect(second.notice).toBeUndefined();
  });

  it('sends Qwen in instruct mode', async () => {
    let body: Record<string, unknown> = {};
    setGroqTransport(async (_url, init) => {
      body = JSON.parse(String(init.body));
      return ok('Hallo Welt.');
    });
    await rewriteText(input);
    expect(body).toMatchObject({ model: 'qwen/qwen3.8-27b', reasoning_effort: 'none', temperature: 0 });
  });

  it('keeps the raw text when the default model fails too', async () => {
    groq(() => gone());
    const result = await rewriteText({ ...input, model: 'openai/gpt-oss-20b' });
    expect(result).toMatchObject({ text: 'hallo welt', usedFallback: true });
  });
});
