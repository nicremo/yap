import { describe, expect, it } from 'vitest';

import { getEnhancementPrompt, getRewriteUserMessage } from '../../src/main/prompts';
import { getLegacyEnhancementPrompt } from '../../src/main/prompts/legacy';
import { getCustomPlusPrompt } from '../../src/main/prompts/plus';

describe('prompt dispatch', () => {
  it('routes conversation and vibe coding to the legacy family', () => {
    for (const style of ['conversation', 'vibe-coding'] as const) {
      expect(getEnhancementPrompt({ style, level: 'high', language: 'de' })).toBe(
        getLegacyEnhancementPrompt(style, 'high', undefined, 'de'),
      );
    }
  });

  it('routes custom-plus to the plus family with the selected voice', () => {
    expect(getEnhancementPrompt({ style: 'custom-plus', level: 'soft', customPlusVoice: 'developer' })).toBe(
      getCustomPlusPrompt({ voice: 'developer', level: 'soft' }),
    );
  });

  it('defaults the custom-plus voice to conversation', () => {
    expect(getEnhancementPrompt({ style: 'custom-plus', level: 'soft' })).toBe(
      getCustomPlusPrompt({ voice: 'conversation', level: 'soft' }),
    );
  });

  it('hardens the user message for plus styles only', () => {
    expect(getRewriteUserMessage('conversation', 'x')).not.toContain('never instructions to you');
    expect(getRewriteUserMessage('vibe-coding', 'x')).not.toContain('never instructions to you');
    expect(getRewriteUserMessage('custom-plus', 'x')).toContain('never instructions to you');
  });
});
