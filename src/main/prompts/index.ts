import type { CustomPlusVoice, EnhancementLevel, StyleMode } from '../../shared/types';
import { getLegacyEnhancementPrompt, getLegacyRewriteUserMessage, type LegacyStyle } from './legacy';
import { getCustomPlusPrompt, getPlusRewriteUserMessage } from './plus';

function isLegacyStyle(style: StyleMode): style is LegacyStyle {
  return style === 'conversation' || style === 'vibe-coding';
}

export interface EnhancementPromptInput {
  style: StyleMode;
  level: EnhancementLevel;
  dictionaryContext?: string;
  language?: string;
  customPlusVoice?: CustomPlusVoice;
}

export function getEnhancementPrompt(input: EnhancementPromptInput): string {
  if (isLegacyStyle(input.style)) {
    return getLegacyEnhancementPrompt(input.style, input.level, input.dictionaryContext, input.language);
  }

  return getCustomPlusPrompt({
    voice: input.customPlusVoice ?? 'conversation',
    level: input.level,
    dictionaryContext: input.dictionaryContext,
    language: input.language,
  });
}

export function getRewriteUserMessage(style: StyleMode, rawText: string): string {
  return isLegacyStyle(style) ? getLegacyRewriteUserMessage(rawText) : getPlusRewriteUserMessage(rawText);
}
