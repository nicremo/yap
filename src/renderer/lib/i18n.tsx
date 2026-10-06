import { createContext, Fragment, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { MESSAGES, type Locale, type Messages } from '../../shared/i18n';

interface I18n {
  locale: Locale;
  t: Messages;
}

const I18nContext = createContext<I18n>({ locale: 'en', t: MESSAGES.en });

/** The language of a window: the one it opened with, then every switch main announces. */
export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(window.yap.initialLocale);

  useEffect(() => window.yap.onLocale(setLocale), []);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo(() => ({ locale, t: MESSAGES[locale] }), [locale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  return useContext(I18nContext);
}

/** The texts of the current language. */
export function useT(): Messages {
  return useContext(I18nContext).t;
}

/** Puts elements into a text at its {placeholders}, e.g. a keycap or a link. */
export function rich(template: string, parts: Record<string, ReactNode>): ReactNode {
  return template.split(/(\{\w+\})/).map((piece, index) => {
    const name = /^\{(\w+)\}$/.exec(piece)?.[1];
    return name !== undefined && name in parts ? <Fragment key={index}>{parts[name]}</Fragment> : piece;
  });
}
