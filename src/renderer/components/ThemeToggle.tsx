import type { Messages } from '../../shared/i18n';
import type { AppState, ThemePreference } from '../../shared/types';
import { useT } from '../lib/i18n';
import { Icon, type IconName } from './Icon';

const ORDER: readonly ThemePreference[] = ['system', 'light', 'dark'];

const ICONS: Record<ThemePreference, IconName> = {
  system: 'monitor',
  light: 'sun',
  dark: 'moon',
};

export function themeOptions(t: Messages): Array<{ value: ThemePreference; label: string }> {
  return ORDER.map((value) => ({ value, label: t.theme[value] }));
}

/** Cycles System, Light and Dark. Lives in the sidebar footer. */
export function ThemeToggle({ state, onState }: { state: AppState; onState: (next: AppState) => void }) {
  const t = useT();
  const current = state.settings.theme;
  const next = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length];

  return (
    <button
      type="button"
      className="icon-button theme-toggle"
      aria-label={t.theme.current(t.theme[current])}
      title={t.theme.cycle(t.theme[current], t.theme[next])}
      onClick={() => void window.yap.updateSettings({ theme: next }).then(onState)}
    >
      <Icon name={ICONS[current]} size={15} />
    </button>
  );
}
