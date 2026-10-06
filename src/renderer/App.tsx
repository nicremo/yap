import { useState } from 'react';

import type { AppState } from '../shared/types';
import { Icon, type IconName } from './components/Icon';
import { LogoTile } from './components/Logo';
import { ThemeToggle } from './components/ThemeToggle';
import { useAppState } from './lib/store';
import { DictionaryPage } from './pages/DictionaryPage';
import { EnginePage } from './pages/EnginePage';
import { HistoryPage } from './pages/HistoryPage';
import { HomePage } from './pages/HomePage';
import { SettingsPage } from './pages/SettingsPage';
import { StylePage } from './pages/StylePage';
import { SetupWizard } from './setup/SetupWizard';

export type Page = 'home' | 'style' | 'engine' | 'dictionary' | 'history' | 'settings';

const NAVIGATION: ReadonlyArray<{ page: Page; label: string; icon: IconName }> = [
  { page: 'home', label: 'Home', icon: 'home' },
  { page: 'style', label: 'Style', icon: 'sparkles' },
  { page: 'engine', label: 'Engine', icon: 'cpu' },
  { page: 'dictionary', label: 'Dictionary', icon: 'book' },
  { page: 'history', label: 'History', icon: 'clock' },
  { page: 'settings', label: 'Settings', icon: 'sliders' },
];

export function App() {
  const [state, setState] = useAppState();

  if (!state) {
    return (
      <main className="loading">
        <span className="spinner" />
      </main>
    );
  }

  if (!state.settings.setupComplete) {
    return <SetupWizard state={state} onState={setState} />;
  }

  return <MainView state={state} onState={setState} />;
}

function needsAttention(state: AppState): boolean {
  const { permissions, engine, settings } = state;
  const micBlocked = permissions.microphone === 'denied' || permissions.microphone === 'restricted';
  const engineMissing = settings.transcriptionMode === 'cloud' ? !engine.groqKeySet : !engine.localModelReady;
  const nativeMissing = permissions.nativePermissionsRequired && (!permissions.accessibility || !permissions.hotkeyActive);
  return micBlocked || engineMissing || nativeMissing;
}

function MainView({ state, onState }: { state: AppState; onState: (next: AppState) => void }) {
  const [page, setPage] = useState<Page>('home');
  const attention = needsAttention(state);

  return (
    <div className="layout">
      <div className="titlebar" />
      <aside className="sidebar">
        <div className="brand">
          <LogoTile size={30} />
          <span className="brand-name">Yap</span>
        </div>
        <nav className="nav">
          {NAVIGATION.map((item) => (
            <button
              key={item.page}
              type="button"
              className={`nav-item${page === item.page ? ' nav-item-active' : ''}`}
              onClick={() => setPage(item.page)}
            >
              <Icon name={item.icon} size={17} />
              {item.label}
              {item.page === 'home' && attention && <span className="nav-dot" aria-label="Needs attention" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span className={`engine-pill engine-pill-${state.settings.transcriptionMode}`}>
            <Icon name={state.settings.transcriptionMode === 'cloud' ? 'cloud' : 'laptop'} size={13} />
            {state.settings.transcriptionMode === 'cloud' ? 'Groq cloud' : 'Local'}
          </span>
          <ThemeToggle state={state} onState={onState} />
          <span className="version">v{state.version}</span>
        </div>
      </aside>

      <main className="content">
        <div className="page" key={page}>
          {page === 'home' && <HomePage state={state} onState={onState} navigate={setPage} />}
          {page === 'style' && <StylePage state={state} onState={onState} />}
          {page === 'engine' && <EnginePage state={state} onState={onState} />}
          {page === 'dictionary' && <DictionaryPage state={state} />}
          {page === 'history' && <HistoryPage state={state} />}
          {page === 'settings' && <SettingsPage state={state} onState={onState} />}
        </div>
      </main>
    </div>
  );
}
