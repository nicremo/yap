import type { CustomPlusVoice, EnhancementLevel, StyleMode } from '../shared/types';
import { DEFAULT_REWRITE_MODEL, findRewriteModel } from '../shared/models';
import { chatWithGroq, isModelUnavailableError, type ChatResult } from './groq';
import { markRewriteModelUnavailable, resolveRewriteModel } from './groq-models';
import { t } from './i18n';
import { getEnhancementPrompt, getRewriteUserMessage } from './prompts';

function stripReasoningArtifacts(text: string): string {
  let result = text
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/<think>[\s\S]*$/g, '');

  // OpenAI Harmony format: everything after the "final" channel is the answer.
  const finalChannel = result.match(
    /<\|?channel\|?>\s*final[\s\S]*?<\|?message\|?>([\s\S]*?)(?:<\|?end\|?>|<\|?return\|?>|$)/i,
  );
  if (finalChannel?.[1]) {
    result = finalChannel[1];
  }

  return result.replace(/<\|[^|>]*\|>/g, '').trim();
}

/** Removes the wrapping a model sometimes adds despite being told not to. */
export function cleanRewriteOutput(content: string | undefined, rawText: string): string {
  const trimmed = stripReasoningArtifacts(content ?? '');
  if (!trimmed) {
    return rawText;
  }

  const unquoted =
    trimmed.length > 1 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith('„') && trimmed.endsWith('“')))
      ? trimmed.slice(1, -1).trim()
      : trimmed;

  const unwrapped = unquoted.replace(/^<dictation>\s*([\s\S]*?)\s*<\/dictation>$/i, '$1');

  if (!/^(sure|here(?:'s| is)|rewritten|revised|updated|i changed|i rewrote|i made|this is)\b/i.test(unwrapped)) {
    return unwrapped;
  }

  const colonIndex = unwrapped.indexOf(':');
  if (colonIndex >= 0) {
    const afterColon = unwrapped.slice(colonIndex + 1).trim();
    if (afterColon) {
      return afterColon;
    }
  }
  return unwrapped;
}

/** Room for the rewrite plus a little reasoning, without letting a long dictation get cut off. */
export function estimateMaxTokens(text: string): number {
  return Math.min(16_384, 512 + Math.ceil(text.length / 2));
}

export interface RewriteInput {
  apiKey: string;
  model: string;
  text: string;
  style: StyleMode;
  level: EnhancementLevel;
  voice: CustomPlusVoice;
  language: string;
  dictionaryContext: string;
  signal?: AbortSignal;
}

export interface RewriteOutput {
  text: string;
  usedFallback: boolean;
  /** The model that produced the text. */
  model: string;
  notice?: string;
}

export async function rewriteText(input: RewriteInput): Promise<RewriteOutput> {
  const systemPrompt = getEnhancementPrompt({
    style: input.style,
    level: input.level,
    dictionaryContext: input.dictionaryContext,
    language: input.language || undefined,
    customPlusVoice: input.voice,
  });

  const request = (model: string): Promise<ChatResult> =>
    chatWithGroq({
      apiKey: input.apiKey,
      model,
      systemPrompt,
      userMessage: getRewriteUserMessage(input.style, input.text),
      maxTokens: estimateMaxTokens(input.text),
      extraParams: findRewriteModel(model)?.params,
      timeoutMs: 10_000 + Math.ceil(input.text.length / 1_000) * 2_000,
      signal: input.signal,
    });

  // A model known to be unavailable is skipped without a failed round trip.
  let model = resolveRewriteModel(input.model);
  let notice: string | undefined;

  try {
    let result: ChatResult;
    try {
      result = await request(model);
    } catch (error) {
      if (!isModelUnavailableError(error) || model === DEFAULT_REWRITE_MODEL) throw error;
      // Preview models can disappear overnight: this dictation still gets polished.
      console.warn('[yap] rewrite model unavailable, falling back to the default:', model);
      if (markRewriteModelUnavailable(model)) {
        const gone = findRewriteModel(model)?.label ?? model;
        const fallback = findRewriteModel(DEFAULT_REWRITE_MODEL)?.label ?? DEFAULT_REWRITE_MODEL;
        notice = t().rewrite.modelFallback(gone, fallback);
      }
      model = DEFAULT_REWRITE_MODEL;
      result = await request(model);
    }

    if (result.finishReason === 'length') {
      return {
        text: input.text,
        usedFallback: true,
        model,
        notice: t().rewrite.cutOff,
      };
    }

    return { text: cleanRewriteOutput(result.content, input.text), usedFallback: false, model, notice };
  } catch (error) {
    if (input.signal?.aborted) {
      throw error;
    }
    const reason = error instanceof Error ? error.message : String(error);
    console.warn('[yap] rewrite failed, using the raw transcript:', reason);
    return {
      text: input.text,
      usedFallback: true,
      model,
      notice: t().rewrite.failed(reason),
    };
  }
}
