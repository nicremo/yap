import type { EnhancementLevel, PublicSettings, UpdateSettingsInput } from '../../shared/types';

/** One scale for how much Yap reworks a dictation, from untouched to polished. */
export type PolishValue = 'off' | EnhancementLevel;

/** In order; labels and captions come from the texts under polish. */
export const POLISH_LEVELS: ReadonlyArray<{ value: PolishValue; intensity: number }> = [
  { value: 'off', intensity: 0 },
  { value: 'none', intensity: 1 },
  { value: 'soft', intensity: 2 },
  { value: 'medium', intensity: 3 },
  { value: 'high', intensity: 4 },
];

export function polishValue(settings: PublicSettings): PolishValue {
  return settings.enhancementEnabled ? settings.enhancementLevel : 'off';
}

export function polishUpdate(value: PolishValue): UpdateSettingsInput {
  return value === 'off' ? { enhancementEnabled: false } : { enhancementEnabled: true, enhancementLevel: value };
}
