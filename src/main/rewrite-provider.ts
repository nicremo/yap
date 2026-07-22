import type { AppSettings } from '../shared/types';
import { getApiKey, getOpenrouterApiKey } from './api-key';

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api';

export interface RewriteTarget {
  baseUrl: string;
  apiKey: string;
  model: string;
  extraHeaders?: Record<string, string>;
  providerOptions?: { sort: 'throughput' };
}

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
      extraHeaders: {
        'HTTP-Referer': 'https://github.com/nicremo/openwhisp-enhanced',
        'X-Title': 'OpenWhisp',
      },
      providerOptions: settings.openrouterSpeedRouting ? { sort: 'throughput' } : undefined,
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
