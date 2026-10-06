import { MESSAGES, type Locale, type Messages } from '../shared/i18n';

/* The language main writes statuses, notifications and menus in. Set from
   the setting at startup and whenever it changes; English until then. */
let current: Locale = 'en';

/** Returns whether the language actually changed. */
export function setLocale(locale: Locale): boolean {
  if (locale === current) return false;
  current = locale;
  return true;
}

export function currentLocale(): Locale {
  return current;
}

/** The texts of the current language. Read at the moment of use, so a switch takes effect right away. */
export function t(): Messages {
  return MESSAGES[current];
}
