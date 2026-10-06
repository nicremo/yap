import { useEffect, useRef, useState } from 'react';

import type { AppState } from '../shared/types';
import { Icon, type IconName } from './components/Icon';
import { LogoImage } from './components/Logo';
import { ThemeToggle } from './components/ThemeToggle';
import { findIssues } from './lib/issues';
import { useAppState } from './lib/store';
import { DictionaryPage } from './pages/DictionaryPage';
import { EnginePage } from './pages/EnginePage';
import { HistoryPage } from './pages/HistoryPage';
import { HomePage } from './pages/HomePage';
import { SettingsPage } from './pages/SettingsPage';
import { StylePage } from './pages/StylePage';
import { SetupWizard } from './setup/SetupWizard';

export type Page = 'home' | 'history' | 'style' | 'engine' | 'dictionary' | 'settings';

const NAVIGATION: ReadonlyArray<{ page: Page; label: string; icon: IconName }> = [
  { page: 'home', label: 'Home', icon: 'home' },
  { page: 'history', label: 'History', icon: 'clock' },
  { page: 'style', label: 'Style', icon: 'sparkles' },
  { page: 'engine', label: 'Engine', icon: 'cpu' },
  { page: 'dictionary', label: 'Dictionary', icon: 'book' },
  { page: 'settings', label: 'Settings', icon: 'sliders' },
];

export function App() {
  const [state, setState] = useAppState();
  const theme = state?.settings.theme;

  // Mirrors the theme choice for CSS. macOS also follows nativeTheme.
  useEffect(() => {
    if (!theme) return;
    if (theme === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
  }, [theme]);

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

function EngineStatus({ state, onOpen }: { state: AppState; onOpen: () => void }) {
  const cloud = state.settings.transcriptionMode === 'cloud';
  const ready = cloud ? state.engine.groqKeySet : state.engine.localModelReady;
  const label = cloud ? 'Groq' : state.platform === 'darwin' ? 'On this Mac' : 'On this PC';
  const detail = ready ? 'ready' : cloud ? 'needs a key' : 'needs a model';

  return (
    <button
      type="button"
      className={`engine-status${ready ? '' : ' engine-status-off'}`}
      title={`Transcription: ${label}, ${detail}`}
      onClick={onOpen}
    >
      <span className="status-dot" />
      <span className="engine-status-label">{label}</span>
    </button>
  );
}

function MainView({ state, onState }: { state: AppState; onState: (next: AppState) => void }) {
  const [page, setPage] = useState<Page>('home');
  const content = useRef<HTMLElement>(null);
  const attention = findIssues(state).length > 0;

  // Every page starts at its top, not where the previous one was scrolled to.
  useEffect(() => {
    content.current?.scrollTo(0, 0);
  }, [page]);

  return (
    <div className="layout">
      <div className="titlebar" />
      <aside className="sidebar">
        <div className="brand">
          <LogoImage className="brand-logo" />
          <span className="brand-name">Yap</span>
        </div>
        <nav className="nav" aria-label="Sections">
          {NAVIGATION.map((item) => (
            <button
              key={item.page}
              type="button"
              className={`nav-item${page === item.page ? ' nav-item-active' : ''}`}
              aria-current={page === item.page ? 'page' : undefined}
              onClick={() => setPage(item.page)}
            >
              <Icon name={item.icon} size={16} />
              {item.label}
              {item.page === 'home' && attention && <span className="nav-dot" role="img" aria-label="Needs attention" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <EngineStatus state={state} onOpen={() => setPage('engine')} />
          <ThemeToggle state={state} onState={onState} />
          <span className="version">v{state.version}</span>
        </div>
      </aside>

      <main className="content" ref={content}>
        <div className="page" key={page}>
          {page === 'home' && <HomePage state={state} onState={onState} navigate={setPage} />}
          {page === 'history' && <HistoryPage state={state} />}
          {page === 'style' && <StylePage state={state} onState={onState} navigate={setPage} />}
          {page === 'engine' && <EnginePage state={state} onState={onState} navigate={setPage} />}
          {page === 'dictionary' && <DictionaryPage state={state} />}
          {page === 'settings' && <SettingsPage state={state} onState={onState} />}
        </div>
      </main>
    </div>
  );
}
