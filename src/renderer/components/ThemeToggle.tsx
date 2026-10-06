import type { AppState, ThemePreference } from '../../shared/types';
import { Icon, type IconName } from './Icon';

const ORDER: readonly ThemePreference[] = ['system', 'light', 'dark'];

const META: Record<ThemePreference, { icon: IconName; label: string }> = {
  system: { icon: 'monitor', label: 'System' },
  light: { icon: 'sun', label: 'Light' },
  dark: { icon: 'moon', label: 'Dark' },
};

export const THEME_OPTIONS = ORDER.map((value) => ({ value, label: META[value].label }));

/** Cycles System, Light and Dark. Lives in the sidebar footer. */
export function ThemeToggle({ state, onState }: { state: AppState; onState: (next: AppState) => void }) {
  const current = state.settings.theme;
  const next = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length];
  const { icon, label } = META[current];

  return (
    <button
      type="button"
      className="icon-button theme-toggle"
      aria-label={`Theme: ${label}`}
      title={`Theme: ${label}. Click for ${META[next].label}.`}
      onClick={() => void window.yap.updateSettings({ theme: next }).then(onState)}
    >
      <Icon name={icon} size={15} />
    </button>
  );
}
