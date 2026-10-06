import { de } from './de';
import { en, type Messages } from './en';

export type { Messages };

export type Locale = 'en' | 'de';
/** What the user picked in Settings. System follows the language of the computer. */
export type UiLanguage = 'system' | Locale;

export const LOCALES: readonly Locale[] = ['en', 'de'];
export const UI_LANGUAGES: readonly UiLanguage[] = ['system', 'en', 'de'];

/** Every language in its own words, for the language picker. */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: 'English',
  de: 'Deutsch',
};

export const MESSAGES: Record<Locale, Messages> = { en, de };

export function isLocale(value: unknown): value is Locale {
  return LOCALES.includes(value as Locale);
}

/**
 * The language Yap speaks. For System, the first preferred language of the
 * computer that Yap knows, the way macOS picks an app's localization:
 * French, German, English means German.
 */
export function resolveLocale(preference: UiLanguage, systemLanguages: readonly string[]): Locale {
  if (preference !== 'system') return preference;
  for (const tag of systemLanguages) {
    const language = tag.toLowerCase().split(/[-_]/)[0];
    if (isLocale(language)) return language;
  }
  return 'en';
}

/* ── Formatting ─────────────────────────────────────────────────────────── */

const numberFormats = new Map<string, Intl.NumberFormat>();

function numberFormat(locale: Locale, fractionDigits: number): Intl.NumberFormat {
  const key = `${locale}:${fractionDigits}`;
  let format = numberFormats.get(key);
  if (!format) {
    format = new Intl.NumberFormat(locale, { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits });
    numberFormats.set(key, format);
  }
  return format;
}

export function formatNumber(value: number, locale: Locale, fractionDigits = 0): string {
  return numberFormat(locale, fractionDigits).format(value);
}

/** A latency, e.g. 0.42 s in English and 0,42 s in German. */
export function formatSeconds(ms: number, locale: Locale): string {
  return `${formatNumber(ms / 1000, locale, ms < 10_000 ? 2 : 1)} s`;
}

/** Megabytes with one decimal below ten, e.g. for download progress. */
export function formatMegabytes(bytes: number, locale: Locale): string {
  const megabytes = bytes / 1_000_000;
  return formatNumber(megabytes, locale, megabytes < 10 ? 1 : 0);
}
