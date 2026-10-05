import type { CustomPlusVoice, EnhancementLevel, StyleMode } from '../../shared/types';

export interface LevelOption {
  value: EnhancementLevel;
  label: string;
  caption: string;
  intensity: number;
}

export const LEVEL_OPTIONS: LevelOption[] = [
  { value: 'none', label: 'No filter', caption: 'Spelling and punctuation only. Your exact words.', intensity: 1 },
  { value: 'soft', label: 'Soft', caption: 'Fillers out, grammar fixed, your voice intact.', intensity: 2 },
  { value: 'medium', label: 'Medium', caption: 'Awkward phrasing restructured into clear prose.', intensity: 3 },
  { value: 'high', label: 'High', caption: 'Rough dictation turned into polished writing.', intensity: 4 },
];

export const PLUS_LEVEL_CAPTIONS: Record<EnhancementLevel, string> = {
  none: 'Spelling, commas, umlauts. Your words stay.',
  soft: 'Plus hesitation sounds removed, meaning-carrying fillers kept.',
  medium: 'Plus restructuring, self-corrections resolved, sentence starts varied.',
  high: 'Full professional polish, fragments completed.',
};

export const STYLE_TABS: ReadonlyArray<{ value: StyleMode; label: string; description: string }> = [
  {
    value: 'conversation',
    label: 'Conversation',
    description: 'Natural conversation style for messages, notes and everyday writing.',
  },
  {
    value: 'vibe-coding',
    label: 'Vibe Coding',
    description: 'Developer mode: turns your speech into proper software engineering language.',
  },
  {
    value: 'custom-plus',
    label: 'Custom +',
    description:
      'The tuned prompt set: prompt-injection guard, German spelling, number and date rules, Markdown lists and self-correction handling.',
  },
];

export const STYLE_LABELS: Record<StyleMode, string> = {
  conversation: 'Conversation',
  'vibe-coding': 'Vibe Coding',
  'custom-plus': 'Custom +',
};

export const LEVEL_LABELS: Record<EnhancementLevel, string> = {
  none: 'No filter',
  soft: 'Soft',
  medium: 'Medium',
  high: 'High',
};

export const LEGACY_EXAMPLES: Record<'conversation' | 'vibe-coding', Record<EnhancementLevel, string>> = {
  conversation: {
    none: 'I went to the store and bought some stuff for the project.',
    soft: 'I went to the store and picked up some things for the project.',
    medium: 'I stopped by the store and picked up supplies for the project.',
    high: 'I visited the store to procure the necessary supplies for our project.',
  },
  'vibe-coding': {
    none: "We need to refactor the auth thing because it's hitting the database too much.",
    soft: "We need to refactor the auth module because it's making too many database calls.",
    medium: 'We need to refactor the authentication service to reduce excessive database queries.',
    high: 'The authentication service requires refactoring to optimize query patterns and eliminate redundant database round-trips.',
  },
};

/* Custom+ examples are German, because that is where its extra rules show:
   umlauts, commas, filler handling and the sentence-start rule. */
export const PLUS_EXAMPLES: Record<CustomPlusVoice, Record<EnhancementLevel, string>> = {
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
    high: 'Der Authentication-Service braucht ein Refactoring, um die Anzahl der DB-Calls zu reduzieren. Zusätzlich wird user id zu user_id umbenannt.',
  },
};
