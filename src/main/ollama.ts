import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import type { OllamaModelInfo } from '../shared/types';

const isMac = process.platform === 'darwin';
const isWindows = process.platform === 'win32';

interface OllamaTagsResponse {
  models?: Array<{
    name: string;
    size: number;
    modified_at?: string;
  }>;
}

const OLLAMA_DISCOVERY_TIMEOUT_MS = 5_000;
const OLLAMA_PULL_TIMEOUT_MS = 600_000;
const OLLAMA_CHAT_TIMEOUT_MS = 90_000;

function buildUrl(baseUrl: string, pathName: string): string {
  return new URL(pathName, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString();
}

function formatOllamaConnectionMessage(baseUrl: string): string {
  return `Ollama is not running at ${baseUrl}. Start the Ollama app or run \`ollama serve\`, then try again.`;
}

function toOllamaError(baseUrl: string, error: unknown, timeoutMs?: number): Error {
  if (error instanceof Error) {
    const nested = (error as Error & { cause?: { code?: string } }).cause;
    if (nested?.code === 'ECONNREFUSED') {
      return new Error(formatOllamaConnectionMessage(baseUrl));
    }

    if (error.name === 'AbortError') {
      const seconds = timeoutMs ? Math.round(timeoutMs / 1000) : 5;
      return new Error(`Ollama did not respond at ${baseUrl} within ${seconds} seconds.`);
    }

    if (error.message === 'fetch failed') {
      return new Error(formatOllamaConnectionMessage(baseUrl));
    }
  }

  return error instanceof Error ? error : new Error('OpenWhisp could not reach Ollama.');
}

async function fetchWithTimeout(
  input: string,
  init?: RequestInit,
  timeoutMs = OLLAMA_DISCOVERY_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

const OLLAMA_MAC_PATH = '/Applications/Ollama.app';

function getOllamaWindowsPath(): string | null {
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) return null;
  const candidate = path.join(localAppData, 'Programs', 'Ollama', 'ollama.exe');
  return fs.existsSync(candidate) ? candidate : null;
}

export function isOllamaInstalled(): boolean {
  if (isMac) return fs.existsSync(OLLAMA_MAC_PATH);
  if (isWindows) return getOllamaWindowsPath() !== null;
  return false;
}

export async function launchOllamaApp(): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (isMac) {
      execFile('open', ['-a', 'Ollama'], (error) => {
        if (error) reject(error);
        else resolve();
      });
      return;
    }

    if (isWindows) {
      const exePath = getOllamaWindowsPath();
      if (!exePath) {
        reject(new Error('Ollama is not installed.'));
        return;
      }
      const child = execFile(exePath, ['serve'], (error: Error | null) => {
        if (error) reject(error);
        else resolve();
      });
      child.unref();
      resolve();
      return;
    }

    reject(new Error('Unsupported platform for Ollama auto-launch.'));
  });
}

async function waitForOllama(baseUrl: string, attempts = 10): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    if (await isOllamaReachable(baseUrl)) return true;
    await new Promise((r) => setTimeout(r, 1_000));
  }
  return false;
}

export async function ensureOllamaRunning(baseUrl: string): Promise<boolean> {
  if (await isOllamaReachable(baseUrl)) return true;
  if (!isOllamaInstalled()) return false;
  try {
    await launchOllamaApp();
    return waitForOllama(baseUrl);
  } catch {
    return false;
  }
}

export async function isOllamaReachable(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetchWithTimeout(
      buildUrl(baseUrl, '/api/version'),
      undefined,
      OLLAMA_DISCOVERY_TIMEOUT_MS,
    );
    return response.ok;
  } catch {
    return false;
  }
}

export async function listOllamaModels(baseUrl: string): Promise<OllamaModelInfo[]> {
  try {
    const response = await fetchWithTimeout(
      buildUrl(baseUrl, '/api/tags'),
      undefined,
      OLLAMA_DISCOVERY_TIMEOUT_MS,
    );
    if (!response.ok) {
      throw new Error('OpenWhisp could not read the local Ollama models.');
    }

    const payload = (await response.json()) as OllamaTagsResponse;

    return (payload.models ?? [])
      .map((model) => ({
        name: model.name,
        size: model.size,
        modifiedAt: model.modified_at,
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
  } catch (error) {
    throw toOllamaError(baseUrl, error, OLLAMA_DISCOVERY_TIMEOUT_MS);
  }
}

export async function pullOllamaModel(
  baseUrl: string,
  modelName: string,
  onProgress?: (status: string) => void,
): Promise<void> {
  try {
    const response = await fetchWithTimeout(
      buildUrl(baseUrl, '/api/pull'),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: modelName,
          stream: true,
        }),
      },
      OLLAMA_PULL_TIMEOUT_MS,
    );

    if (!response.ok || !response.body) {
      throw new Error('OpenWhisp could not download the Ollama model.');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffered = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffered += decoder.decode(value, { stream: true });
      const lines = buffered.split('\n');
      buffered = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.trim()) {
          continue;
        }

        const payload = JSON.parse(line) as {
          status?: string;
          completed?: number;
          total?: number;
        };

        if (typeof payload.completed === 'number' && typeof payload.total === 'number' && payload.total > 0) {
          const percent = Math.min(100, Math.round((payload.completed / payload.total) * 100));
          onProgress?.(`Downloading ${modelName} (${percent}%)`);
        } else if (payload.status) {
          onProgress?.(payload.status);
        }
      }
    }
  } catch (error) {
    throw toOllamaError(baseUrl, error, OLLAMA_PULL_TIMEOUT_MS);
  }
}

export async function rewriteWithOllama(
  baseUrl: string,
  modelName: string,
  systemPrompt: string,
  rawText: string,
): Promise<string> {
  try {
    const response = await fetchWithTimeout(
      buildUrl(baseUrl, '/api/chat'),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: modelName,
          stream: false,
          think: false,
          keep_alive: '10m',
          options: {
            temperature: 0,
          },
          messages: [
            {
              role: 'system',
              content: systemPrompt,
            },
            {
              role: 'user',
              content: [
                'Rewrite the dictated text below.',
                'If the speaker corrected themselves or changed their mind, use only their final intent.',
                'Reply with only the final rewritten text — no preface, explanation, labels, or quotation marks.',
                '',
                '<dictation>',
                rawText,
                '</dictation>',
              ].join('\n'),
            },
          ],
        }),
      },
      OLLAMA_CHAT_TIMEOUT_MS,
    );

    if (!response.ok) {
      throw new Error('OpenWhisp could not reach Ollama for the rewrite pass.');
    }

    const payload = (await response.json()) as {
      message?: {
        content?: string;
      };
    };

    return cleanRewriteOutput(payload.message?.content, rawText);
  } catch (error) {
    throw toOllamaError(baseUrl, error, OLLAMA_CHAT_TIMEOUT_MS);
  }
}

function stripThinkingTags(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/<think>[\s\S]*$/g, '')
    .trim();
}

function cleanRewriteOutput(content: string | undefined, rawText: string): string {
  const trimmed = stripThinkingTags(content ?? '').trim();
  if (!trimmed) {
    return rawText;
  }

  const stripped =
    trimmed.startsWith('"') && trimmed.endsWith('"')
      ? trimmed.slice(1, -1).trim()
      : trimmed.startsWith("'") && trimmed.endsWith("'")
        ? trimmed.slice(1, -1).trim()
        : trimmed;

  const metaLeadPattern =
    /^(sure|here(?:'s| is)|rewritten|revised|updated|i changed|i rewrote|i made|this is)/i;

  if (!metaLeadPattern.test(stripped)) {
    return stripped;
  }

  const quotedMatches = Array.from(
    stripped.matchAll(/["“”'`](.+?)["“”'`]/g),
    (match) => match[1]?.trim(),
  ).filter((value): value is string => Boolean(value));

  if (quotedMatches.length > 0) {
    return quotedMatches.sort((left, right) => right.length - left.length)[0];
  }

  const colonIndex = stripped.indexOf(':');
  if (colonIndex >= 0) {
    const afterColon = stripped.slice(colonIndex + 1).trim();
    const cleanedTail = afterColon.replace(/\bI changed\b[\s\S]*$/i, '').trim();
    if (cleanedTail) {
      return cleanedTail;
    }
  }

  return stripped;
}
