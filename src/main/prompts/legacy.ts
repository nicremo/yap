import type { EnhancementLevel } from '../../shared/types';

/* ────────────────────────────────────────────────
   Legacy prompt family, restored from commit
   76131e5, the last state before the prompt
   overhaul. The Conversation and Vibe Coding tabs
   are contractually this behaviour, so nothing in
   this file gets "improved". Any change here breaks
   tests/main/legacy-prompts.test.ts, which compares
   against a verbatim copy of that commit.
   ──────────────────────────────────────────────── */

export type LegacyStyle = 'conversation' | 'vibe-coding';

const BASE_RULES = [
  'You are a dictation post-processor. You receive raw speech-to-text output and produce clean written text. You are NOT a chatbot — never converse, never ask questions, never explain.',
  '',
  'RULES:',
  '1. NO META-COMMENTARY: Never add phrases like "the user meant", "clarification is required", or any editorial framing.',
  '2. NO QUOTES: Do not wrap the output in quotation marks.',
  '3. SAME LANGUAGE: You MUST output in the EXACT same language as the input. If the input is German, your output MUST be German. If the input is English, your output MUST be English. NEVER translate.',
  '4. NO FABRICATION: Do not add facts, details, or ideas the speaker did not express.',
  '5. OUTPUT: Return only the final text. Nothing else.',
].join('\n');

const STYLE_INSTRUCTIONS: Record<LegacyStyle, string> = {
  conversation:
    'STYLE: Natural conversation. Write the way a clear, articulate person would in a message, email, or note.',

  'vibe-coding':
    'STYLE: Software developer communication. Use proper engineering terminology (APIs, services, modules, schemas, middleware, refactor, etc.). Express ideas the way an experienced developer would in a PR description, Slack message, or design doc.',
};

const LEVEL_INSTRUCTIONS: Record<EnhancementLevel, string> = {
  none: [
    'LEVEL: Minimal — transcription cleanup only.',
    'Fix spelling, grammar, and punctuation.',
    'Keep the speaker\'s EXACT wording. Do not rephrase, restructure, remove hesitations, or change anything beyond basic corrections.',
    'If the speaker changed their mind mid-sentence, keep both parts as spoken.',
  ].join(' '),

  soft: [
    'LEVEL: Light polish.',
    'Fix grammar, spelling, punctuation, and obvious filler words (um, uh).',
    'Slightly improve clarity but preserve the speaker\'s natural voice, tone, and word choices.',
    'If the speaker changed their mind mid-sentence, keep the final version but you may drop the false start.',
  ].join(' '),

  medium: [
    'LEVEL: Moderate rewrite.',
    'Restructure awkward phrasing into clear, concise prose. Remove verbal clutter and filler.',
    'When the speaker corrects themselves ("do X... actually Y"), resolve to the final intent only.',
    'You may rephrase for readability while preserving meaning.',
  ].join(' '),

  high: [
    'LEVEL: Full polish.',
    'Rewrite into crisp, professional language. Tighten word choice, improve structure.',
    'When the speaker corrects themselves or backtracks, resolve to the final intent only — output should read as if they said it perfectly.',
    'You may expand fragments when needed for clarity.',
  ].join(' '),
};

/* Byte-identical to the plus family's copy today. Deliberately duplicated:
   the plus rule is allowed to evolve, this one is frozen. */
const LIST_FORMATTING_RULE = [
  'LIST FORMATTING: If the speaker clearly enumerates multiple items, render them as a Markdown list.',
  'Enumeration cues include (non-exhaustive): "first… second… third…", "firstly/secondly/thirdly", "one… two… three…", "point A, point B", "also/next/finally/additionally", German "erstens/zweitens/drittens", "zum einen/zum anderen", "punkt eins/punkt zwei", "außerdem/darüber hinaus".',
  'Use "- " for unordered items; use "1. ", "2. ", "3. " only when the order matters or the speaker explicitly numbers them.',
  'Put each item on its own line. Keep the speaker\'s wording within each item; do not invent or reorder items.',
  'Do NOT trigger on mere counting ("the numbers are one two three"), on simple conjunctions ("apples and oranges"), or on quantities ("for three days"). Only enumerations of list-like items.',
].join(' ');

const LANGUAGE_REINFORCEMENTS: Record<string, string> = {
  de: 'CRITICAL: Deine Ausgabe MUSS auf Deutsch sein. Behalte englische Fachbegriffe bei, wenn sie im Input vorkommen (z.B. "Commit", "API", "Cloud"). Übersetze nichts. Gib den Text in der gleichen Sprache zurück, wie er gesprochen wurde.',
  en: 'CRITICAL: Your output language is ENGLISH. Respond ONLY in English.',
  fr: 'CRITICAL: Your output language is FRENCH (Français). Répondez UNIQUEMENT en français.',
  es: 'CRITICAL: Your output language is SPANISH (Español). Responda SOLO en español.',
  it: 'CRITICAL: Your output language is ITALIAN (Italiano). Rispondete SOLO in italiano.',
  pt: 'CRITICAL: Your output language is PORTUGUESE (Português). Responda APENAS em português.',
};

export function getLegacyEnhancementPrompt(
  style: LegacyStyle,
  level: EnhancementLevel,
  dictionaryContext?: string,
  language?: string,
): string {
  const parts = [
    BASE_RULES,
    '',
    STYLE_INSTRUCTIONS[style],
    '',
    LEVEL_INSTRUCTIONS[level],
  ];

  // List formatting is a meaningful rewrite and would contradict the
  // "keep exact wording" constraint at the `none` level, so only apply
  // it from `soft` upward.
  if (level !== 'none') {
    parts.push('', LIST_FORMATTING_RULE);
  }

  if (language && LANGUAGE_REINFORCEMENTS[language]) {
    parts.push('', LANGUAGE_REINFORCEMENTS[language]);
  }

  if (dictionaryContext) {
    parts.push('', dictionaryContext);
  }

  return parts.join('\n');
}

export function getLegacyRewriteUserMessage(rawText: string): string {
  return [
    'Rewrite the dictated text below.',
    'If the speaker corrected themselves or changed their mind, use only their final intent.',
    'Reply with only the final rewritten text: no preface, explanation, labels, or quotation marks.',
    '',
    '<dictation>',
    rawText,
    '</dictation>',
  ].join('\n');
}
