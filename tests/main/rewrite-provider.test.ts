import { describe, expect, it } from 'vitest';

import type { AppSettings } from '../../src/shared/types';
import { encryptApiKey } from '../../src/main/api-key';
import {
  FIREWORKS_BASE_URL,
  resolveRewriteFallback,
  resolveRewriteTarget,
} from '../../src/main/rewrite-provider';

function settings(overrides: Partial<AppSettings>): AppSettings {
  return {
    cloudRewriteProvider: 'fireworks',
    cloudRewriteModel: 'openai/gpt-oss-20b',
    cloudApiBaseUrl: 'https://api.groq.com/openai',
    openaiApiKeyEncrypted: '',
    openrouterApiKeyEncrypted: '',
    openrouterModel: 'google/gemini-3.5-flash-lite',
    openrouterSpeedRouting: true,
    fireworksApiKeyEncrypted: encryptApiKey('fw-key'),
    fireworksModel: 'accounts/fireworks/routers/glm-5p2-fast',
    ...overrides,
  } as AppSettings;
}

describe('resolveRewriteTarget', () => {
  it('still resolves Fireworks unchanged', () => {
    const target = resolveRewriteTarget(settings({}));
    expect(target).toEqual({
      baseUrl: FIREWORKS_BASE_URL,
      apiKey: 'fw-key',
      model: 'accounts/fireworks/routers/glm-5p2-fast',
    });
  });

  it('still resolves OpenRouter with speed routing unchanged', () => {
    const target = resolveRewriteTarget(settings({
      cloudRewriteProvider: 'openrouter',
      openrouterApiKeyEncrypted: encryptApiKey('or-key'),
    }));
    expect(target?.model).toBe('google/gemini-3.5-flash-lite');
    expect(target?.providerOptions).toEqual({ sort: 'throughput' });
    expect(target?.timeoutMs).toBeUndefined();
  });
});

describe('resolveRewriteFallback', () => {
  it('only retries locally after a failed Groq request', () => {
    expect(resolveRewriteFallback({ provider: 'groq' }).retryLocallyAfterCloudFailure).toBe(true);
    expect(resolveRewriteFallback({ provider: 'openrouter' }).retryLocallyAfterCloudFailure).toBe(false);
    expect(resolveRewriteFallback({ provider: 'fireworks' }).retryLocallyAfterCloudFailure).toBe(false);
  });

  it('labels the provider that served the request', () => {
    expect(resolveRewriteFallback({ provider: 'groq' }).providerLabel).toBe('Groq');
    expect(resolveRewriteFallback({ provider: 'openrouter' }).providerLabel).toBe('OpenRouter');
    expect(resolveRewriteFallback({ provider: 'fireworks' }).providerLabel).toBe('Fireworks');
  });
});
