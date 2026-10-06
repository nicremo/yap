import type { Messages } from '../../shared/i18n';
import type { CustomPlusVoice, EnhancementLevel, StyleMode } from '../../shared/types';
import type { PolishValue } from './polish';

/** The writing styles in tab order; names and descriptions come from the texts under style. */
export const STYLE_MODES: readonly StyleMode[] = ['conversation', 'vibe-coding', 'custom-plus'];

/* Custom examples are German in every language, because that is where its
   extra rules show: umlauts, commas, filler handling and the sentence-start rule. */
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
export function exampleFor(
  style: StyleMode,
  voice: CustomPlusVoice,
  polish: PolishValue,
  t: Messages,
): { spoken: string; written: string } {
  if (style === 'custom-plus') {
    const spoken = CUSTOM_SPOKEN[voice];
    return { spoken, written: polish === 'off' ? spoken : CUSTOM_POLISHED[voice][polish] };
  }
  const example = t.style.examples[style === 'vibe-coding' ? 'vibe-coding' : 'conversation'];
  return { spoken: example.spoken, written: polish === 'off' ? example.spoken : example[polish] };
}
