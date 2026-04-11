import { useEffect, useRef, useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { Home01Icon, PaintBrush01Icon, CubeIcon, Settings01Icon } from '@hugeicons/core-free-icons';

import { AudioRecorder } from './audio-recorder';
import logoUrl from './logo.png';
import type { AppStatus, BootstrapState, EnhancementLevel, FocusInfo, StyleMode } from '../shared/types';
import { RECOMMENDED_TEXT_MODEL, RECOMMENDED_WHISPER_LABEL } from '../shared/recommendations';

const OVERLAY_VIEW = window.location.hash === '#overlay';

type Page = 'home' | 'style' | 'models' | 'preferences';

interface LevelOption {
  value: EnhancementLevel;
  label: string;
  caption: string;
  detail: string;
  intensity: number;
}

interface StyleOption {
  value: StyleMode;
  label: string;
  description: string;
  levels: Record<EnhancementLevel, { example: string }>;
}

const LEVEL_OPTIONS: LevelOption[] = [
  { value: 'none', label: 'No filter', caption: 'Minimal touch — fix typos only.', detail: 'Corrects spelling and punctuation. Your exact words, cleaned up.', intensity: 1 },
  { value: 'soft', label: 'Soft', caption: 'Light grammar and clarity polish.', detail: 'Fixes filler words and grammar while keeping your natural voice.', intensity: 2 },
  { value: 'medium', label: 'Medium', caption: 'Rewrite for natural, clear prose.', detail: 'Restructures awkward phrasing into clean, readable text.', intensity: 3 },
  { value: 'high', label: 'High', caption: 'Professional polish and expansion.', detail: 'Turns rough dictation into polished, professional writing.', intensity: 4 },
];

const STYLE_OPTIONS: StyleOption[] = [
  {
    value: 'conversation',
    label: 'Conversation',
    description: 'Natural conversation style. Perfect for messages, notes, and everyday writing.',
    levels: {
      none: { example: 'I went to the store and bought some stuff for the project.' },
      soft: { example: 'I went to the store and picked up some things for the project.' },
      medium: { example: 'I stopped by the store and picked up supplies for the project.' },
      high: { example: 'I visited the store to procure the necessary supplies for our project.' },
    },
  },
  {
    value: 'vibe-coding',
    label: 'Vibe Coding',
    description: 'Developer mode. Translates your speech into proper software engineering language.',
    levels: {
      none: { example: 'We need to refactor the auth thing because it\'s hitting the database too much.' },
      soft: { example: 'We need to refactor the auth module because it\'s making too many database calls.' },
      medium: { example: 'We need to refactor the authentication service to reduce excessive database queries.' },
      high: { example: 'The authentication service requires refactoring to optimize query patterns and eliminate redundant database round-trips.' },
    },
  },
];

const GRID_COLS = 7;
const GRID_ROWS = 3;
const GRID_TOTAL = GRID_COLS * GRID_ROWS;

function formatBytes(size: number): string {
  if (size <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let current = size;
  let unitIndex = 0;
  while (current >= 1024 && unitIndex < units.length - 1) {
    current /= 1024;
    unitIndex += 1;
  }
  return `${current.toFixed(current >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function CheckIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

/* ────────────────────────────────────────────────
   App
   ──────────────────────────────────────────────── */

export function App() {
  const [bootstrap, setBootstrap] = useState<BootstrapState | null>(null);
  const [status, setStatus] = useState<AppStatus>({
    phase: 'idle',
    title: 'Ready',
    detail: 'Hold Fn to dictate. Release Fn to paste.',
  });
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const recorderRef = useRef<AudioRecorder | null>(null);
  const recordingRef = useRef(false);
  const processingRef = useRef(false);
  const bootstrapRef = useRef<BootstrapState | null>(null);
  const targetFocusRef = useRef<FocusInfo | null>(null);

  useEffect(() => { bootstrapRef.current = bootstrap; }, [bootstrap]);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      const next = await window.openWhisp.bootstrap();
      if (!mounted) return;
      setBootstrap(next);
      setStatus(next.status);
    };
    void load();
    const stopStatus = window.openWhisp.onStatus((s) => { if (mounted) setStatus(s); });
    const stopHotkey = OVERLAY_VIEW
      ? window.openWhisp.onHotkey((e) => {
          if (e.type === 'down') void handleHotkeyDown();
          if (e.type === 'up') void handleHotkeyUp();
        })
      : () => undefined;
    return () => { mounted = false; stopStatus(); stopHotkey(); };
  }, []);

  useEffect(() => {
    if (OVERLAY_VIEW) {
      const recorder = new AudioRecorder();
      recorder.onLevel = (level) => setAudioLevel(level);
      recorderRef.current = recorder;
    }
  }, []);

  useEffect(() => {
    if (status.phase !== 'listening') setAudioLevel(0);
  }, [status.phase]);

  const refreshBootstrap = async () => {
    const next = await window.openWhisp.bootstrap();
    bootstrapRef.current = next;
    setBootstrap(next);
    setStatus(next.status);
    return next;
  };

  const pushStatus = (s: AppStatus) => { setStatus(s); window.openWhisp.pushStatus(s); };

  const runAction = async (label: string, action: () => Promise<BootstrapState>) => {
    try {
      setBusyAction(label);
      const next = await action();
      bootstrapRef.current = next;
      setBootstrap(next);
      setStatus(next.status);
    } catch (error) {
      pushStatus({
        phase: 'error',
        title: 'Action failed',
        detail: error instanceof Error ? error.message : 'Could not complete this action.',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleHotkeyDown = async () => {
    const current = await refreshBootstrap();
    const modelInstalled = current.ollamaModels.some((m) => m.name === current.settings.textModel);
    if (recordingRef.current || processingRef.current) return;

    if (current.permissions.microphone !== 'granted') {
      pushStatus({ phase: 'error', title: 'Microphone needed', detail: 'Grant microphone access in setup.' });
      await window.openWhisp.showMainWindow();
      return;
    }
    if (!current.permissions.inputMonitoring || !current.permissions.postEvents || !current.permissions.accessibility) {
      pushStatus({ phase: 'error', title: 'System access needed', detail: 'Enable permissions in setup.' });
      await window.openWhisp.showMainWindow();
      return;
    }
    if (!current.speechModelReady) {
      pushStatus({ phase: 'error', title: 'Speech model unavailable', detail: 'Download the speech model first.' });
      await window.openWhisp.showMainWindow();
      return;
    }
    if (!current.ollamaReachable || !modelInstalled) {
      pushStatus({ phase: 'error', title: 'Text model unavailable', detail: 'Start Ollama and install the rewrite model.' });
      await window.openWhisp.showMainWindow();
      return;
    }

    try {
      targetFocusRef.current = await window.openWhisp.captureFocusTarget();
      recordingRef.current = true;
      await recorderRef.current?.start();
      pushStatus({ phase: 'listening', title: 'Listening', detail: 'Speak while holding Fn.' });
    } catch (error) {
      recordingRef.current = false;
      pushStatus({ phase: 'error', title: 'Microphone error', detail: error instanceof Error ? error.message : 'Microphone could not start.' });
    }
  };

  const handleHotkeyUp = async () => {
    if (!recordingRef.current || processingRef.current) return;
    recordingRef.current = false;
    processingRef.current = true;
    try {
      const wavBase64 = await recorderRef.current?.stop();
      if (!wavBase64) throw new Error('No recording was captured.');
      const result = await window.openWhisp.processAudio({ wavBase64, targetFocus: targetFocusRef.current ?? undefined });
      pushStatus({
        phase: 'done',
        title: result.pasted ? 'Pasted' : 'Copied',
        detail: result.pasted ? 'Refined text pasted into the active app.' : 'Refined text is on the clipboard.',
        preview: result.finalText,
        rawText: result.rawText,
      });
    } catch (error) {
      pushStatus({ phase: 'error', title: 'Dictation failed', detail: error instanceof Error ? error.message : 'Could not finish dictation.' });
    } finally {
      targetFocusRef.current = null;
      processingRef.current = false;
    }
  };

  if (OVERLAY_VIEW) return <OverlayBar status={status} audioLevel={audioLevel} />;
  if (!bootstrap) {
    return <main className="app-shell loading-shell"><div className="loading-spinner" /><span className="loading-text">Loading Openwhisp</span></main>;
  }
  if (!bootstrap.settings.setupComplete) {
    return <SetupWizard bootstrap={bootstrap} busyAction={busyAction} onAction={runAction} onRefresh={refreshBootstrap} onComplete={() => void runAction('setup', () => window.openWhisp.updateSettings({ setupComplete: true }))} />;
  }

  return <MainView bootstrap={bootstrap} status={status} busyAction={busyAction} onAction={runAction} />;
}

/* ────────────────────────────────────────────────
   Setup Wizard (unchanged structure)
   ──────────────────────────────────────────────── */

function SetupWizard({ bootstrap, busyAction, onAction, onRefresh, onComplete }: {
  bootstrap: BootstrapState; busyAction: string | null;
  onAction: (l: string, a: () => Promise<BootstrapState>) => Promise<void>;
  onRefresh: () => Promise<BootstrapState>; onComplete: () => void;
}) {
  const steps = ['welcome', 'ollama', 'models', 'permissions', 'ready'] as const;
  type Step = (typeof steps)[number];
  const [step, setStep] = useState<Step>('welcome');
  const idx = steps.indexOf(step);
  const next = () => { if (idx + 1 < steps.length) setStep(steps[idx + 1]); };
  const back = () => { if (idx > 0) setStep(steps[idx - 1]); };

  return (
    <main className="setup-shell">
      <div className="drag-region" />
      <div className="setup-progress">
        {steps.map((s, i) => (
          <div key={s} className={`setup-dot${i <= idx ? ' setup-dot-active' : ''}${i === idx ? ' setup-dot-current' : ''}`} />
        ))}
      </div>
      <div className="setup-body" key={step}>
        {step === 'welcome' && (
          <div className="setup-step setup-step-center">
            <div className="fn-key"><span>fn</span></div>
            <h1 className="setup-title serif">Welcome to Openwhisp</h1>
            <p className="setup-desc">Local dictation powered by Whisper and Ollama. Your voice stays on your machine.</p>
            <div className="setup-nav"><div /><button className="btn btn-primary" onClick={next}>Get Started</button></div>
          </div>
        )}
        {step === 'ollama' && <OllamaStep bootstrap={bootstrap} onRefresh={onRefresh} onNext={next} onBack={back} />}
        {step === 'models' && <ModelsStep bootstrap={bootstrap} busyAction={busyAction} onAction={onAction} onNext={next} onBack={back} />}
        {step === 'permissions' && <PermissionsStep bootstrap={bootstrap} busyAction={busyAction} onAction={onAction} onNext={next} onBack={back} />}
        {step === 'ready' && (
          <div className="setup-step setup-step-center">
            <div className="ready-icon"><CheckIcon size={32} /></div>
            <h1 className="setup-title serif">You're All Set</h1>
            <p className="setup-desc">Hold Fn to dictate. Release it and Openwhisp handles the rest.</p>
            <div className="setup-nav"><button className="btn btn-ghost" onClick={back}>Back</button><button className="btn btn-primary" onClick={onComplete}>Start Dictating</button></div>
          </div>
        )}
      </div>
    </main>
  );
}

function OllamaStep({ bootstrap, onRefresh, onNext, onBack }: { bootstrap: BootstrapState; onRefresh: () => Promise<BootstrapState>; onNext: () => void; onBack: () => void }) {
  const [checking, setChecking] = useState(false);
  const retry = async () => { setChecking(true); await onRefresh(); setChecking(false); };
  return (
    <div className="setup-step">
      <h1 className="setup-title serif">Connect to Ollama</h1>
      <p className="setup-desc">Ollama runs AI models locally. Openwhisp uses it to enhance your dictated text.</p>
      <div className="s-card">
        <div className="s-card-row">
          <div className="s-card-info"><strong>Ollama Server</strong><span>{bootstrap.settings.ollamaBaseUrl}</span></div>
          {bootstrap.ollamaReachable ? <span className="badge badge-ready"><CheckIcon size={12} /> Connected</span> : <span className="badge badge-pending">Not running</span>}
        </div>
        {!bootstrap.ollamaReachable && (
          <div className="s-card-bottom">
            <p className="s-card-hint">Install and start Ollama to continue.</p>
            <div className="btn-group">
              <button className="btn btn-secondary" onClick={() => void window.openWhisp.openExternal('https://ollama.com/download/mac')}>Install Ollama</button>
              <button className="btn btn-secondary" onClick={() => void retry()} disabled={checking}>{checking ? 'Checking...' : 'Retry'}</button>
            </div>
          </div>
        )}
        {bootstrap.ollamaReachable && bootstrap.ollamaModels.length > 0 && <div className="s-card-meta">{bootstrap.ollamaModels.length} model{bootstrap.ollamaModels.length !== 1 ? 's' : ''} available</div>}
      </div>
      <div className="setup-nav"><button className="btn btn-ghost" onClick={onBack}>Back</button><button className="btn btn-primary" onClick={onNext} disabled={!bootstrap.ollamaReachable}>Continue</button></div>
    </div>
  );
}

function ModelsStep({ bootstrap, busyAction, onAction, onNext, onBack }: { bootstrap: BootstrapState; busyAction: string | null; onAction: (l: string, a: () => Promise<BootstrapState>) => Promise<void>; onNext: () => void; onBack: () => void }) {
  return (
    <div className="setup-step">
      <h1 className="setup-title serif">Download Models</h1>
      <p className="setup-desc">Two AI models power Openwhisp — one for speech and one for text enhancement.</p>
      <div className="s-card">
        <div className="s-card-label">Speech to Text</div>
        <div className="s-card-row">
          <div className="s-card-info"><strong>{RECOMMENDED_WHISPER_LABEL}</strong><span>Local speech recognition</span></div>
          {bootstrap.speechModelReady ? <span className="badge badge-ready"><CheckIcon size={12} /> Ready</span> : <button className="btn btn-sm btn-primary" disabled={busyAction === 'speech'} onClick={() => void onAction('speech', () => window.openWhisp.prepareSpeechModel())}>{busyAction === 'speech' ? 'Downloading...' : 'Download'}</button>}
        </div>
      </div>
      <div className="s-card">
        <div className="s-card-label">Text Enhancement</div>
        <div className="s-card-row">
          <div className="s-card-info"><strong>{RECOMMENDED_TEXT_MODEL}</strong><span>Polishes your transcribed text</span></div>
          {bootstrap.recommendedModelInstalled ? <span className="badge badge-ready"><CheckIcon size={12} /> Ready</span> : <button className="btn btn-sm btn-primary" disabled={busyAction === 'model' || !bootstrap.ollamaReachable} onClick={() => void onAction('model', () => window.openWhisp.pullRecommendedModel())}>{busyAction === 'model' ? 'Downloading...' : 'Download'}</button>}
        </div>
      </div>
      <div className="setup-nav"><button className="btn btn-ghost" onClick={onBack}>Back</button><button className="btn btn-primary" onClick={onNext} disabled={!bootstrap.speechModelReady || !bootstrap.recommendedModelInstalled}>Continue</button></div>
    </div>
  );
}

function PermissionsStep({ bootstrap, busyAction, onAction, onNext, onBack }: { bootstrap: BootstrapState; busyAction: string | null; onAction: (l: string, a: () => Promise<BootstrapState>) => Promise<void>; onNext: () => void; onBack: () => void }) {
  const micOk = bootstrap.permissions.microphone === 'granted';
  const sysOk = bootstrap.permissions.accessibility && bootstrap.permissions.inputMonitoring && bootstrap.permissions.postEvents;
  return (
    <div className="setup-step">
      <h1 className="setup-title serif">Allow Access</h1>
      <p className="setup-desc">Openwhisp needs permissions to listen, transcribe, and paste.</p>
      <div className="s-card">
        <div className="s-card-row">
          <div className="s-card-info"><strong>Microphone</strong><span>Captures your voice</span></div>
          {micOk ? <span className="badge badge-ready"><CheckIcon size={12} /> Granted</span> : <button className="btn btn-sm btn-primary" disabled={busyAction === 'mic'} onClick={() => void onAction('mic', () => window.openWhisp.requestMicrophoneAccess())}>{busyAction === 'mic' ? 'Requesting...' : 'Allow'}</button>}
        </div>
        <div className="s-card-divider" />
        <div className="s-card-row">
          <div className="s-card-info"><strong>System Access</strong><span>Fn key and auto-paste</span></div>
          {sysOk ? <span className="badge badge-ready"><CheckIcon size={12} /> Granted</span> : <button className="btn btn-sm btn-primary" disabled={busyAction === 'system'} onClick={() => void onAction('system', () => window.openWhisp.requestSystemAccess())}>{busyAction === 'system' ? 'Opening...' : 'Allow'}</button>}
        </div>
      </div>
      {!sysOk && <p className="setup-hint">macOS will prompt you in System Settings. You may need to restart the app.</p>}
      <div className="setup-nav"><button className="btn btn-ghost" onClick={onBack}>Back</button><button className="btn btn-primary" onClick={onNext} disabled={!micOk || !sysOk}>Continue</button></div>
    </div>
  );
}

/* ────────────────────────────────────────────────
   Main View – sidebar + pages
   ──────────────────────────────────────────────── */

function MainView({ bootstrap, status, busyAction, onAction }: {
  bootstrap: BootstrapState; status: AppStatus; busyAction: string | null;
  onAction: (l: string, a: () => Promise<BootstrapState>) => Promise<void>;
}) {
  const [page, setPage] = useState<Page>('home');

  return (
    <div className="layout">
      <div className="drag-region" />

      <aside className="sidebar">
        <div className="sidebar-brand">
          <img src={logoUrl} alt="" className="sidebar-logo" />
          <h1 className="serif">Openwhisp</h1>
        </div>
        <nav className="sidebar-nav">
          <button className={`nav-item${page === 'home' ? ' nav-item-active' : ''}`} onClick={() => setPage('home')}>
            <HugeiconsIcon icon={Home01Icon} size={18} strokeWidth={2} /> Home
          </button>
          <button className={`nav-item${page === 'style' ? ' nav-item-active' : ''}`} onClick={() => setPage('style')}>
            <HugeiconsIcon icon={PaintBrush01Icon} size={18} strokeWidth={2} /> Style
          </button>
          <button className={`nav-item${page === 'models' ? ' nav-item-active' : ''}`} onClick={() => setPage('models')}>
            <HugeiconsIcon icon={CubeIcon} size={18} strokeWidth={2} /> Models
          </button>
          <button className={`nav-item${page === 'preferences' ? ' nav-item-active' : ''}`} onClick={() => setPage('preferences')}>
            <HugeiconsIcon icon={Settings01Icon} size={18} strokeWidth={2} /> Preferences
          </button>
        </nav>
        <div className="sidebar-footer">
          <button className="btn btn-link btn-muted" onClick={() => void onAction('setup', () => window.openWhisp.updateSettings({ setupComplete: false }))}>Reset Setup</button>
          <div className="sidebar-credits">
            <button className="credit-link" onClick={() => void window.openWhisp.openExternal('https://x.com/GiusMarci')}>@GiusMarci</button>
            <span className="credit-dot" />
            <button className="credit-link" onClick={() => void window.openWhisp.openExternal('https://raelume.ai')}>raelume.ai</button>
          </div>
        </div>
      </aside>

      <main className="content">
        {page === 'home' && <HomePage status={status} bootstrap={bootstrap} setPage={setPage} />}
        {page === 'style' && <StylePage bootstrap={bootstrap} onAction={onAction} />}
        {page === 'models' && <ModelsPage bootstrap={bootstrap} busyAction={busyAction} onAction={onAction} />}
        {page === 'preferences' && <PreferencesPage bootstrap={bootstrap} onAction={onAction} />}
      </main>
    </div>
  );
}

/* ── Home ─────────────────────────────────────── */

function HomePage({ status, bootstrap, setPage }: { status: AppStatus; bootstrap: BootstrapState; setPage: (p: Page) => void }) {
  const level = LEVEL_OPTIONS.find((l) => l.value === bootstrap.settings.enhancementLevel);
  const style = STYLE_OPTIONS.find((s) => s.value === bootstrap.settings.styleMode);
  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title serif">Welcome back</h2>
      </div>

      <div className="banner">
        <div className="banner-content">
          <h3 className="serif">Press Fn. Speak. Done.</h3>
          <p>Your voice, transcribed and polished entirely on your Mac. No cloud. No latency.</p>
        </div>
        <div className="banner-visual" aria-hidden="true">
          <div className="banner-circle" />
          <div className="banner-circle banner-circle-2" />
        </div>
      </div>

      <div className="home-grid">
        <div className="card status-card">
          <div className="status-row">
            <div className={`status-dot status-${status.phase}`} />
            <div className="status-info">
              <strong>{status.title}</strong>
              <span>{status.detail}</span>
            </div>
          </div>
          {status.preview && <pre className="status-preview">{status.preview}</pre>}
        </div>

        <div className="home-stats">
          <button className="stat-card" onClick={() => setPage('style')}>
            <span className="stat-value">{style?.label ?? 'Conversation'}</span>
            <span className="stat-label">{level?.label ?? 'Medium'}</span>
          </button>
          <button className="stat-card" onClick={() => setPage('models')}>
            <span className="stat-value stat-value-sm">{bootstrap.settings.textModel.split(':')[0]}</span>
            <span className="stat-label">Text model</span>
          </button>
          <button className="stat-card" onClick={() => setPage('models')}>
            <span className={`stat-value ${bootstrap.ollamaReachable ? 'stat-ok' : 'stat-off'}`}>{bootstrap.ollamaReachable ? 'Online' : 'Offline'}</span>
            <span className="stat-label">Ollama</span>
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Style ─────────────────────────────────────── */

function StylePage({ bootstrap, onAction }: { bootstrap: BootstrapState; onAction: (l: string, a: () => Promise<BootstrapState>) => Promise<void> }) {
  const activeStyle = STYLE_OPTIONS.find((s) => s.value === bootstrap.settings.styleMode) ?? STYLE_OPTIONS[0];

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title serif">Style</h2>
        <p className="page-desc">Choose your dictation style and enhancement level.</p>
      </div>

      <div className="style-tabs">
        {STYLE_OPTIONS.map((s) => (
          <button
            key={s.value}
            className={`style-tab${bootstrap.settings.styleMode === s.value ? ' style-tab-active' : ''}`}
            onClick={() => void onAction('settings', () => window.openWhisp.updateSettings({ styleMode: s.value }))}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className={`style-banner${activeStyle.value === 'vibe-coding' ? ' style-banner-dev' : ''}`}>
        <p>{activeStyle.description}</p>
      </div>

      <div className="enhance-grid">
        {LEVEL_OPTIONS.map((level) => {
          const active = bootstrap.settings.enhancementLevel === level.value;
          const example = activeStyle.levels[level.value].example;
          return (
            <button
              key={level.value}
              className={`enhance-card${active ? ' enhance-card-active' : ''}`}
              onClick={() => void onAction('settings', () => window.openWhisp.updateSettings({ enhancementLevel: level.value }))}
            >
              <div className="enhance-card-top">
                <strong className="serif">{level.label}</strong>
                {active && <span className="badge badge-ready">Active</span>}
              </div>
              <p className="enhance-caption">{level.caption}</p>
              <p className="enhance-example">"{example}"</p>
              <div className="intensity-bar">
                {[1, 2, 3, 4].map((i) => (
                  <span key={i} className={`intensity-dot${i <= level.intensity ? ' intensity-dot-on' : ''}`} />
                ))}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ── Models ───────────────────────────────────── */

function ModelsPage({ bootstrap, busyAction, onAction }: { bootstrap: BootstrapState; busyAction: string | null; onAction: (l: string, a: () => Promise<BootstrapState>) => Promise<void> }) {
  const [ollamaUrl, setOllamaUrl] = useState(bootstrap.settings.ollamaBaseUrl);
  useEffect(() => { setOllamaUrl(bootstrap.settings.ollamaBaseUrl); }, [bootstrap.settings.ollamaBaseUrl]);

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title serif">Models</h2>
        <p className="page-desc">Configure the AI models that power your dictation.</p>
      </div>

      <div className="card">
        <div className="card-head"><h3>Speech to Text</h3></div>
        <div className="model-row">
          <div className="model-info">
            <strong>{bootstrap.settings.whisperLabel}</strong>
            <span>Local Whisper model for speech recognition</span>
          </div>
          {bootstrap.speechModelReady
            ? <span className="badge badge-ready"><CheckIcon size={12} /> Ready</span>
            : <button className="btn btn-sm btn-primary" disabled={busyAction === 'speech'} onClick={() => void onAction('speech', () => window.openWhisp.prepareSpeechModel())}>{busyAction === 'speech' ? 'Downloading...' : 'Download'}</button>
          }
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h3>Text Enhancement</h3>
          <button className="btn btn-link" onClick={() => void onAction('refresh', () => window.openWhisp.refreshOllama())}>Refresh</button>
        </div>
        <div className="setting-row">
          <label className="setting-label" htmlFor="model-select">Rewrite model</label>
          <select id="model-select" className="setting-select" value={bootstrap.settings.textModel} onChange={(e) => void onAction('settings', () => window.openWhisp.updateSettings({ textModel: e.target.value }))}>
            {bootstrap.ollamaModels.length === 0
              ? <option value={bootstrap.settings.textModel}>{bootstrap.settings.textModel}</option>
              : bootstrap.ollamaModels.map((m) => <option key={m.name} value={m.name}>{m.name} ({formatBytes(m.size)})</option>)
            }
          </select>
        </div>
        {!bootstrap.recommendedModelInstalled && bootstrap.ollamaReachable && (
          <button className="btn btn-sm btn-primary" style={{ marginTop: 10 }} disabled={busyAction === 'model'} onClick={() => void onAction('model', () => window.openWhisp.pullRecommendedModel())}>
            {busyAction === 'model' ? 'Downloading...' : `Download ${RECOMMENDED_TEXT_MODEL}`}
          </button>
        )}
      </div>

      <div className="card">
        <div className="card-head"><h3>Ollama Connection</h3></div>
        <div className="setting-row">
          <label className="setting-label" htmlFor="ollama-url">Server URL</label>
          <div className="url-field">
            <input id="ollama-url" className="setting-input" value={ollamaUrl} onChange={(e) => setOllamaUrl(e.target.value)} onBlur={() => void onAction('settings', () => window.openWhisp.updateSettings({ ollamaBaseUrl: ollamaUrl }))} />
            <span className={`url-badge${bootstrap.ollamaReachable ? ' url-badge-ok' : ' url-badge-off'}`}>{bootstrap.ollamaReachable ? 'Connected' : 'Offline'}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Preferences ──────────────────────────────── */

function PreferencesPage({ bootstrap, onAction }: { bootstrap: BootstrapState; onAction: (l: string, a: () => Promise<BootstrapState>) => Promise<void> }) {
  const p = bootstrap.permissions;
  const micOk = p.microphone === 'granted';
  const sysOk = p.accessibility && p.inputMonitoring && p.postEvents;

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title serif">Preferences</h2>
        <p className="page-desc">Customize how Openwhisp works.</p>
      </div>

      <div className="card">
        <div className="card-head"><h3>Behavior</h3></div>
        <ToggleRow title="Auto-paste" description="Paste into the active app after rewriting" checked={bootstrap.settings.autoPaste} onChange={(v) => void onAction('settings', () => window.openWhisp.updateSettings({ autoPaste: v }))} />
        <ToggleRow title="Show overlay" description="Show the dictation badge on screen" checked={bootstrap.settings.showOverlay} onChange={(v) => void onAction('settings', () => window.openWhisp.updateSettings({ showOverlay: v }))} />
        <ToggleRow title="Launch at login" description="Start Openwhisp when you log in" checked={bootstrap.settings.launchAtLogin} onChange={(v) => void onAction('settings', () => window.openWhisp.updateSettings({ launchAtLogin: v }))} />
      </div>

      <div className="card">
        <div className="card-head">
          <h3>Permissions</h3>
          <button className="btn btn-link" onClick={() => void onAction('refresh', () => window.openWhisp.bootstrap())}>Refresh</button>
        </div>
        <div className="perm-grid">
          <div className="perm-row">
            <span className="perm-name">Microphone</span>
            <span className={`perm-status${micOk ? ' perm-ok' : ' perm-missing'}`}>{micOk ? 'Granted' : 'Not granted'}</span>
            {!micOk && <button className="btn btn-sm btn-primary" onClick={() => void onAction('mic', () => window.openWhisp.requestMicrophoneAccess())}>Allow</button>}
          </div>
          <div className="perm-row">
            <span className="perm-name">Accessibility</span>
            <span className={`perm-status${p.accessibility ? ' perm-ok' : ' perm-missing'}`}>{p.accessibility ? 'Granted' : 'Not granted'}</span>
          </div>
          <div className="perm-row">
            <span className="perm-name">Input Monitoring</span>
            <span className={`perm-status${p.inputMonitoring ? ' perm-ok' : ' perm-missing'}`}>{p.inputMonitoring ? 'Granted' : 'Not granted'}</span>
          </div>
          <div className="perm-row">
            <span className="perm-name">Paste Events</span>
            <span className={`perm-status${p.postEvents ? ' perm-ok' : ' perm-missing'}`}>{p.postEvents ? 'Granted' : 'Not granted'}</span>
          </div>
          {!sysOk && <button className="btn btn-sm btn-secondary" style={{ marginTop: 8 }} onClick={() => void onAction('system', () => window.openWhisp.requestSystemAccess())}>Grant Permissions</button>}
          <button className="btn btn-link btn-muted" style={{ marginTop: 8 }} onClick={() => void window.openWhisp.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy')}>Manage in System Settings</button>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h3>Storage</h3>
          <div className="btn-group-compact">
            <button className="btn btn-link" onClick={() => void onAction('storage', () => window.openWhisp.chooseStorage())}>Change</button>
            <button className="btn btn-link" onClick={() => void window.openWhisp.revealStorage()}>Open</button>
          </div>
        </div>
        <span className="storage-path">{bootstrap.settings.storageDirectory}</span>
      </div>
    </div>
  );
}

/* ── Toggle Row ───────────────────────────────── */

function ToggleRow({ title, description, checked, onChange }: { title: string; description: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="toggle-row">
      <div className="toggle-info"><strong>{title}</strong><span>{description}</span></div>
      <label className="switch"><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /><span className="switch-slider" /></label>
    </div>
  );
}

/* ────────────────────────────────────────────────
   Overlay Bar
   ──────────────────────────────────────────────── */

function OverlayBar({ status, audioLevel }: { status: AppStatus; audioLevel: number }) {
  const isIdle = status.phase === 'idle';
  const isListening = status.phase === 'listening';
  const isProcessing = status.phase === 'transcribing' || status.phase === 'rewriting' || status.phase === 'pasting';
  const isDone = status.phase === 'done';
  const isActive = !isIdle;

  return (
    <div className="overlay-shell">
      <div className={`overlay-bar${isActive ? ' overlay-bar-active' : ''}${isProcessing ? ' overlay-processing' : ''}${isDone ? ' overlay-done' : ''}`}>
        <AudioGrid level={audioLevel} listening={isListening} processing={isProcessing} />
        <span className="overlay-label">{isIdle ? 'Press Fn to dictate' : status.title}</span>
      </div>
    </div>
  );
}

function AudioGrid({ level, listening, processing }: { level: number; listening: boolean; processing: boolean }) {
  const [cells, setCells] = useState<boolean[]>(() => new Array(GRID_TOTAL).fill(false));
  const seedRef = useRef(0);
  useEffect(() => {
    if (!listening) { if (!processing) setCells(new Array(GRID_TOTAL).fill(false)); return; }
    seedRef.current += 1;
    const onCount = Math.round(level * GRID_TOTAL);
    const next = new Array(GRID_TOTAL).fill(false);
    const indices = Array.from({ length: GRID_TOTAL }, (_, i) => i);
    let seed = seedRef.current;
    for (let i = indices.length - 1; i > 0; i--) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const j = seed % (i + 1);
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    for (let i = 0; i < onCount; i++) next[indices[i]] = true;
    setCells(next);
  }, [level, listening, processing]);

  return (
    <div className={`audio-grid${processing ? ' audio-grid-wave' : ''}`}>
      {cells.map((on, i) => (
        <span key={i} className={`grid-cell${on ? ' grid-cell-on' : ''}`} style={processing ? { animationDelay: `${(i % GRID_COLS) * 0.12}s` } : undefined} />
      ))}
    </div>
  );
}
