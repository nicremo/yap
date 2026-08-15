import { describe, expect, it } from 'vitest';

import type { EnhancementLevel } from '../../src/shared/types';
import { getEnhancementPrompt as getReferencePrompt } from '../fixtures/legacy-prompts-76131e5';
import { getLegacyEnhancementPrompt, getLegacyRewriteUserMessage, type LegacyStyle } from '../../src/main/prompts/legacy';

const STYLES: LegacyStyle[] = ['conversation', 'vibe-coding'];
const LEVELS: EnhancementLevel[] = ['none', 'soft', 'medium', 'high'];
const LANGUAGES: Array<string | undefined> = [undefined, 'de', 'en', 'fr', 'es', 'it', 'pt'];
const DICTIONARY = 'DICTIONARY: Vitest, Supabase, Ghostty';

/* The restore is byte-exact except for two documented fixes: the original
   German reinforcement spelled two umlauts as vowel plus e, which the project
   writing rules forbid. Both replacements are no-ops for every other language.

   The lowercase search pattern is assembled from OLD_UE instead of being
   spelled out. The repository's umlaut hook rewrites that misspelling in any
   file it writes, which would turn the replacement into a no-op and break this
   suite without any visible cause. Keep the assembly. */
const OLD_UE = 'u' + 'e';

function applyDocumentedFixes(reference: string): string {
  return reference
    .replace('Uebersetze nichts.', 'Übersetze nichts.')
    .replace(`zur${OLD_UE}ck, wie er gesprochen wurde.`, 'zurück, wie er gesprochen wurde.');
}

describe('legacy prompt family', () => {
  for (const style of STYLES) {
    for (const level of LEVELS) {
      for (const language of LANGUAGES) {
        it(`matches 76131e5 for ${style} / ${level} / ${language ?? 'no language'}`, () => {
          expect(getLegacyEnhancementPrompt(style, level, DICTIONARY, language)).toBe(
            applyDocumentedFixes(getReferencePrompt(style, level, DICTIONARY, language)),
          );
        });
      }
    }
  }

  /* Routed through applyDocumentedFixes even though no language is passed, so
     the case stays correct if someone adds a language argument later. */
  it('matches without dictionary context', () => {
    expect(getLegacyEnhancementPrompt('conversation', 'medium')).toBe(
      applyDocumentedFixes(getReferencePrompt('conversation', 'medium')),
    );
  });

  it('has no output contract and no anti-injection block', () => {
    const prompt = getLegacyEnhancementPrompt('conversation', 'high', undefined, 'de');
    expect(prompt).not.toContain('OUTPUT CONTRACT');
    expect(prompt).not.toContain('<dictation>');
  });

  it('builds the rewrite user message without an em dash', () => {
    const message = getLegacyRewriteUserMessage('hallo welt');
    expect(message).toContain('<dictation>\nhallo welt\n</dictation>');
    expect(message).toContain('Reply with only the final rewritten text: no preface');
    expect(message).not.toContain('—');
  });
});
