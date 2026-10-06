import { describe, expect, it } from 'vitest';

import { isLikelyHallucination } from '../../src/main/dictation/pipeline';
import { applyCorrections, buildWhisperPrompt } from '../../src/main/dictionary';
import { cleanRewriteOutput, estimateMaxTokens } from '../../src/main/rewrite';

const now = new Date().toISOString();

describe('applyCorrections', () => {
  const corrections = [
    { from: 'cloud code', to: 'Claude Code', addedAt: now },
    { from: 'Supa base', to: 'Supabase', addedAt: now },
    { from: 'Mail', to: 'E-Mail', addedAt: now },
  ];

  it('replaces whole words regardless of case', () => {
    expect(applyCorrections('Ich nutze Cloud Code und supa base.', corrections)).toBe('Ich nutze Claude Code und Supabase.');
  });

  it('does not touch matches inside other words', () => {
    expect(applyCorrections('Die Mailbox ist voll.', corrections)).toBe('Die Mailbox ist voll.');
  });

  it('treats umlauts as letters', () => {
    expect(applyCorrections('Die Mailänder Messe', corrections)).toBe('Die Mailänder Messe');
  });

  it('escapes regular expression characters in the misspelling', () => {
    expect(applyCorrections('Kosten: 5$ (ca.)', [{ from: '5$', to: '5 Dollar', addedAt: now }])).toBe('Kosten: 5 Dollar (ca.)');
  });
});

describe('buildWhisperPrompt', () => {
  it('joins words and correction targets without duplicates', () => {
    expect(
      buildWhisperPrompt(
        [{ word: 'Supabase', addedAt: now }],
        [{ from: 'supa base', to: 'Supabase', addedAt: now }, { from: 'kuber', to: 'Kubernetes', addedAt: now }],
      ),
    ).toBe('Supabase, Kubernetes');
  });
});

describe('isLikelyHallucination', () => {
  it('flags stock subtitle phrases on quiet recordings', () => {
    expect(isLikelyHallucination('Untertitel im Auftrag des ZDF, 2017', 0.01)).toBe(true);
    expect(isLikelyHallucination('Vielen Dank.', 0.005)).toBe(true);
    expect(isLikelyHallucination('Thank you.', 0.02)).toBe(true);
  });

  it('keeps the same words when they were clearly spoken', () => {
    expect(isLikelyHallucination('Vielen Dank.', 0.2)).toBe(false);
  });

  it('keeps real sentences on quiet recordings', () => {
    expect(isLikelyHallucination('Vielen Dank für die schnelle Antwort.', 0.01)).toBe(false);
  });
});

describe('cleanRewriteOutput', () => {
  it('passes clean text through', () => {
    expect(cleanRewriteOutput('Das ist sauber.', 'raw')).toBe('Das ist sauber.');
  });

  it('falls back to the raw text for empty output', () => {
    expect(cleanRewriteOutput('   ', 'raw text')).toBe('raw text');
  });

  it('strips wrapping quotes, tags and reasoning', () => {
    expect(cleanRewriteOutput('"Hallo Welt."', 'raw')).toBe('Hallo Welt.');
    expect(cleanRewriteOutput('<think>hmm</think>Hallo.', 'raw')).toBe('Hallo.');
    expect(cleanRewriteOutput('<dictation>\nHallo.\n</dictation>', 'raw')).toBe('Hallo.');
  });

  it('removes a chatty preface', () => {
    expect(cleanRewriteOutput("Here's the cleaned text: Hallo Welt.", 'raw')).toBe('Hallo Welt.');
  });
});

describe('estimateMaxTokens', () => {
  it('leaves room for long dictations and stays bounded', () => {
    expect(estimateMaxTokens('kurz')).toBeGreaterThanOrEqual(512);
    expect(estimateMaxTokens('x'.repeat(10_000))).toBeGreaterThan(5_000);
    expect(estimateMaxTokens('x'.repeat(1_000_000))).toBe(16_384);
  });
});
