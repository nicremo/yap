import type { EnhancementLevel, PublicSettings, UpdateSettingsInput } from '../../shared/types';

/** One scale for how much Yap reworks a dictation, from untouched to polished. */
export type PolishValue = 'off' | EnhancementLevel;

export interface PolishOption {
  value: PolishValue;
  label: string;
  caption: string;
  intensity: number;
}

export const POLISH_OPTIONS: readonly PolishOption[] = [
  { value: 'off', label: 'Off', caption: 'Exactly as transcribed.', intensity: 0 },
  { value: 'none', label: 'Minimal', caption: 'Spelling and punctuation only.', intensity: 1 },
  { value: 'soft', label: 'Soft', caption: 'Fillers out, grammar fixed, your voice intact.', intensity: 2 },
  { value: 'medium', label: 'Medium', caption: 'Awkward phrasing turned into clear prose.', intensity: 3 },
  { value: 'high', label: 'High', caption: 'Rough dictation turned into polished writing.', intensity: 4 },
];

export function polishValue(settings: PublicSettings): PolishValue {
  return settings.enhancementEnabled ? settings.enhancementLevel : 'off';
}

export function polishUpdate(value: PolishValue): UpdateSettingsInput {
  return value === 'off' ? { enhancementEnabled: false } : { enhancementEnabled: true, enhancementLevel: value };
}

export function polishLabel(value: PolishValue): string {
  return POLISH_OPTIONS.find((option) => option.value === value)?.label ?? value;
}
