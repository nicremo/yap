import type { AppSettings, CloudRewriteProvider } from '../shared/types';
import { getApiKey, getFireworksApiKey, getOpenrouterApiKey } from './api-key';

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api';
export const FIREWORKS_BASE_URL = 'https://api.fireworks.ai/inference';

export interface RewriteTarget {
  baseUrl: string;
  apiKey: string;
  model: string;
  extraHeaders?: Record<string, string>;
  providerOptions?: { sort: 'throughput' };
  timeoutMs?: number;
}

/* Frozen because every target now shares this one object instead of getting a
   fresh literal, and nothing may mutate a target's headers. */
const OPENROUTER_HEADERS: Record<string, string> = Object.freeze({
  'HTTP-Referer': 'https://github.com/nicremo/openwhisp-enhanced',
  'X-Title': 'OpenWhisp',
});

const PROVIDER_LABELS: Record<CloudRewriteProvider, string> = {
  groq: 'Groq',
  openrouter: 'OpenRouter',
  fireworks: 'Fireworks',
};

export function resolveRewriteTarget(settings: AppSettings): RewriteTarget | null {
  if (settings.cloudRewriteProvider === 'openrouter') {
    const apiKey = getOpenrouterApiKey(settings);
    if (!apiKey) {
      return null;
    }

    return {
      baseUrl: OPENROUTER_BASE_URL,
      apiKey,
      model: settings.openrouterModel,
      extraHeaders: OPENROUTER_HEADERS,
      providerOptions: settings.openrouterSpeedRouting ? { sort: 'throughput' } : undefined,
    };
  }

  if (settings.cloudRewriteProvider === 'fireworks') {
    const apiKey = getFireworksApiKey(settings);
    if (!apiKey) {
      return null;
    }

    return {
      baseUrl: FIREWORKS_BASE_URL,
      apiKey,
      model: settings.fireworksModel,
    };
  }

  const apiKey = getApiKey(settings);
  if (!apiKey) {
    return null;
  }

  return {
    baseUrl: settings.cloudApiBaseUrl,
    apiKey,
    model: settings.cloudRewriteModel,
  };
}

export interface RewriteFallbackPolicy {
  /* May a failed cloud request be retried on the local model? Only the Groq
     path ever did this; OpenRouter and Fireworks keep the raw text. */
  retryLocallyAfterCloudFailure: boolean;
  /* Names the provider that actually served the request, not the configured
     one, so a failure message cannot claim OpenRouter for a Groq request. */
  providerLabel: string;
}

export function resolveRewriteFallback(input: {
  provider: CloudRewriteProvider;
}): RewriteFallbackPolicy {
  return {
    retryLocallyAfterCloudFailure: input.provider === 'groq',
    providerLabel: PROVIDER_LABELS[input.provider],
  };
}

export async function testOpenrouterConnection(
  apiKey: string,
): Promise<{ valid: boolean; error?: string }> {
  try {
    const response = await fetch(`${OPENROUTER_BASE_URL}/v1/key`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (response.ok) {
      return { valid: true };
    }

    if (response.status === 401) {
      return { valid: false, error: 'Invalid OpenRouter API key.' };
    }

    return { valid: false, error: `OpenRouter returned status ${response.status}.` };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : 'Could not reach OpenRouter.',
    };
  }
}

export async function testFireworksConnection(
  apiKey: string,
): Promise<{ valid: boolean; error?: string }> {
  try {
    // /v1/models requires auth on Fireworks (401 without a valid key).
    const response = await fetch(`${FIREWORKS_BASE_URL}/v1/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (response.ok) {
      return { valid: true };
    }

    if (response.status === 401 || response.status === 403) {
      return { valid: false, error: 'Invalid Fireworks API key.' };
    }

    return { valid: false, error: `Fireworks returned status ${response.status}.` };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : 'Could not reach Fireworks.',
    };
  }
}
