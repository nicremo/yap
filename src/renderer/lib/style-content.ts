import type { CustomPlusVoice, EnhancementLevel, StyleMode } from '../../shared/types';
import type { PolishValue } from './polish';

export const STYLE_TABS: ReadonlyArray<{ value: StyleMode; label: string; description: string }> = [
  {
    value: 'conversation',
    label: 'Conversation',
    description: 'Natural writing for messages, notes and everyday text.',
  },
  {
    value: 'vibe-coding',
    label: 'Coding',
    description: 'Turns how developers talk into precise software engineering language.',
  },
  {
    value: 'custom-plus',
    label: 'Custom',
    description:
      'The tuned rule set: German spelling, numbers and dates, Markdown lists, self-corrections resolved and a guard against instructions hidden in the dictation.',
  },
];

export const STYLE_LABELS: Record<StyleMode, string> = {
  conversation: 'Conversation',
  'vibe-coding': 'Coding',
  'custom-plus': 'Custom',
};

export const VOICE_LABELS: Record<CustomPlusVoice, string> = {
  conversation: 'Everyday',
  developer: 'Developer',
};

/** Custom explains its levels in terms of its own rules. */
export const CUSTOM_CAPTIONS: Record<PolishValue, string> = {
  off: 'Exactly as transcribed.',
  none: 'Spelling, commas, umlauts. Your words stay.',
  soft: 'Hesitation sounds removed, fillers that carry meaning kept.',
  medium: 'Restructured, self-corrections resolved, sentence starts varied.',
  high: 'Full professional polish, fragments completed.',
};

/** What gets said, before any polish. */
const SPOKEN: Record<'conversation' | 'vibe-coding', string> = {
  conversation: 'um so I went to the store and uh bought some stuff for the project',
  'vibe-coding': "so we need to like refactor the auth thing because it's hitting the database too much",
};

const POLISHED: Record<'conversation' | 'vibe-coding', Record<EnhancementLevel, string>> = {
  conversation: {
    none: 'Um, so I went to the store and, uh, bought some stuff for the project.',
    soft: 'I went to the store and picked up some things for the project.',
    medium: 'I stopped by the store and picked up supplies for the project.',
    high: 'I visited the store to get the supplies the project needs.',
  },
  'vibe-coding': {
    none: "So we need to, like, refactor the auth thing because it's hitting the database too much.",
    soft: "We need to refactor the auth module because it's making too many database calls.",
    medium: 'We need to refactor the authentication service to reduce excessive database queries.',
    high: 'The authentication service needs a refactor to cut redundant database round trips.',
  },
};

/* Custom examples are German, because that is where its extra rules show:
   umlauts, commas, filler handling and the sentence-start rule. */
const CUSTOM_SPOKEN: Record<CustomPlusVoice, string> = {
  conversation: 'äh wir deployen das am freitag ähm nee warte am donnerstag und ich hab die api keys neu generiert',
  developer: 'wir müssen die auth sache refactoren weil die zu viele db calls macht ähm und user id soll user_id heißen',
};

const CUSTOM_POLISHED: Record<CustomPlusVoice, Record<EnhancementLevel, string>> = {
  conversation: {
    none: 'Äh, wir deployen das am Freitag, ähm, nee, warte, am Donnerstag, und ich habe die API-Keys neu generiert.',
    soft: 'Wir deployen das am Freitag, nee, warte, am Donnerstag, und ich habe die API-Keys neu generiert.',
    medium: 'Wir deployen das am Donnerstag und die API-Keys habe ich neu generiert.',
    high: 'Das Deployment läuft am Donnerstag, die API-Keys sind neu generiert.',
  },
  developer: {
    none: 'Wir müssen die Auth-Sache refactoren, weil die zu viele DB-Calls macht, ähm, und user id soll user_id heißen.',
    soft: 'Wir müssen die Auth-Sache refactoren, weil sie zu viele DB-Calls macht, und user id soll user_id heißen.',
    medium: 'Das Auth-Modul muss refactored werden, weil es zu viele DB-Calls macht, und user id soll user_id heißen.',
    high: 'Der Authentication-Service braucht ein Refactoring, um die DB-Calls zu reduzieren. Außerdem wird user id zu user_id.',
  },
};

/** Before and after for the example panel in Style. */
export function exampleFor(style: StyleMode, voice: CustomPlusVoice, polish: PolishValue): { spoken: string; written: string } {
  if (style === 'custom-plus') {
    const spoken = CUSTOM_SPOKEN[voice];
    return { spoken, written: polish === 'off' ? spoken : CUSTOM_POLISHED[voice][polish] };
  }
  const key = style === 'vibe-coding' ? 'vibe-coding' : 'conversation';
  return { spoken: SPOKEN[key], written: polish === 'off' ? SPOKEN[key] : POLISHED[key][polish] };
}
