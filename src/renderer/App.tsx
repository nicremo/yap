import { useEffect, useRef, useState } from 'react';

import { AudioRecorder } from './audio-recorder';
import type { AppStatus, BootstrapState, EnhancementLevel, FocusInfo } from '../shared/types';
import { RECOMMENDED_TEXT_MODEL, RECOMMENDED_WHISPER_LABEL } from '../shared/recommendations';

const OVERLAY_VIEW = window.location.hash === '#overlay';

const LEVEL_OPTIONS: Array<{ value: EnhancementLevel; label: string; caption: string }> = [
  { value: 'none', label: 'None', caption: 'Minimal touch — fix typos only.' },
  { value: 'soft', label: 'Soft', caption: 'Light grammar and clarity polish.' },
  { value: 'medium', label: 'Medium', caption: 'Rewrite for natural, clear prose.' },
  { value: 'high', label: 'High', caption: 'Professional polish and expansion.' },
];

const SETUP_STEPS = ['welcome', 'ollama', 'models', 'permissions', 'ready'] as const;
type SetupStep = (typeof SETUP_STEPS)[number];

/* ── Grid constants ─────────────────────────── */

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
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

/* ────────────────────────────────────────────────
   App – root component
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

  useEffect(() => {
    bootstrapRef.current = bootstrap;
  }, [bootstrap]);

  useEffect(() => {
    let mounted = true;

    const loadBootstrap = async () => {
      const next = await window.openWhisp.bootstrap();
      if (!mounted) return;
      setBootstrap(next);
      setStatus(next.status);
    };

    void loadBootstrap();

    const stopStatus = window.openWhisp.onStatus((s) => {
      if (mounted) setStatus(s);
    });

    const stopHotkey = OVERLAY_VIEW
      ? window.openWhisp.onHotkey((event) => {
          if (event.type === 'down') void handleHotkeyDown();
          if (event.type === 'up') void handleHotkeyUp();
        })
      : () => undefined;

    return () => {
      mounted = false;
      stopStatus();
      stopHotkey();
    };
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

  const pushStatus = (s: AppStatus) => {
    setStatus(s);
    window.openWhisp.pushStatus(s);
  };

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
    const current = bootstrapRef.current ?? (await refreshBootstrap());
    const selectedModelInstalled = current.ollamaModels.some(
      (model) => model.name === current.settings.textModel,
    );

    if (recordingRef.current || processingRef.current) return;

    if (current.permissions.microphone !== 'granted') {
      pushStatus({
        phase: 'error',
        title: 'Microphone needed',
        detail: 'OpenWhisp needs microphone access before dictation can start.',
      });
      await window.openWhisp.showMainWindow();
      return;
    }

    if (
      !current.permissions.inputMonitoring ||
      !current.permissions.postEvents ||
      !current.permissions.accessibility
    ) {
      pushStatus({
        phase: 'error',
        title: 'System access needed',
        detail: 'Enable Input Monitoring, Accessibility, and Paste permissions in setup first.',
      });
      await window.openWhisp.showMainWindow();
      return;
    }

    if (!current.speechModelReady) {
      pushStatus({
        phase: 'error',
        title: 'Speech model unavailable',
        detail: 'Download the local Whisper speech model in setup before dictation can start.',
      });
      await window.openWhisp.showMainWindow();
      return;
    }

    if (!current.ollamaReachable || !selectedModelInstalled) {
      pushStatus({
        phase: 'error',
        title: 'Text model unavailable',
        detail: 'Start Ollama and make sure the selected rewrite model is installed.',
      });
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
      pushStatus({
        phase: 'error',
        title: 'Microphone error',
        detail: error instanceof Error ? error.message : 'The microphone could not start.',
      });
    }
  };

  const handleHotkeyUp = async () => {
    if (!recordingRef.current || processingRef.current) return;

    recordingRef.current = false;
    processingRef.current = true;

    try {
      const wavBase64 = await recorderRef.current?.stop();
      if (!wavBase64) throw new Error('No recording was captured.');

      const result = await window.openWhisp.processAudio({
        wavBase64,
        targetFocus: targetFocusRef.current ?? undefined,
      });

      pushStatus({
        phase: 'done',
        title: result.pasted ? 'Pasted' : 'Copied',
        detail: result.pasted
          ? 'The refined text was pasted into the active app.'
          : 'The refined text is on the clipboard.',
        preview: result.finalText,
        rawText: result.rawText,
      });
    } catch (error) {
      pushStatus({
        phase: 'error',
        title: 'Dictation failed',
        detail: error instanceof Error ? error.message : 'Could not finish this dictation.',
      });
    } finally {
      targetFocusRef.current = null;
      processingRef.current = false;
    }
  };

  if (OVERLAY_VIEW) return <OverlayBar status={status} audioLevel={audioLevel} />;

  if (!bootstrap) {
    return (
      <main className="app-shell loading-shell">
        <div className="loading-spinner" />
        <span className="loading-text">Loading OpenWhisp</span>
      </main>
    );
  }

  if (!bootstrap.settings.setupComplete) {
    return (
      <SetupWizard
        bootstrap={bootstrap}
        busyAction={busyAction}
        onAction={runAction}
        onRefresh={refreshBootstrap}
        onComplete={() =>
          void runAction('setup', () => window.openWhisp.updateSettings({ setupComplete: true }))
        }
      />
    );
  }

  return (
    <MainView
      bootstrap={bootstrap}
      status={status}
      onAction={runAction}
    />
  );
}

/* ────────────────────────────────────────────────
   Setup Wizard
   ──────────────────────────────────────────────── */

function SetupWizard({
  bootstrap,
  busyAction,
  onAction,
  onRefresh,
  onComplete,
}: {
  bootstrap: BootstrapState;
  busyAction: string | null;
  onAction: (label: string, action: () => Promise<BootstrapState>) => Promise<void>;
  onRefresh: () => Promise<BootstrapState>;
  onComplete: () => void;
}) {
  const [step, setStep] = useState<SetupStep>('welcome');
  const stepIndex = SETUP_STEPS.indexOf(step);

  const goNext = () => {
    const next = stepIndex + 1;
    if (next < SETUP_STEPS.length) setStep(SETUP_STEPS[next]);
  };

  const goBack = () => {
    const prev = stepIndex - 1;
    if (prev >= 0) setStep(SETUP_STEPS[prev]);
  };

  return (
    <main className="setup-shell">
      <div className="drag-region" />

      <div className="setup-progress">
        {SETUP_STEPS.map((s, i) => (
          <div
            key={s}
            className={`setup-dot${i <= stepIndex ? ' setup-dot-active' : ''}${i === stepIndex ? ' setup-dot-current' : ''}`}
          />
        ))}
      </div>

      <div className="setup-body" key={step}>
        {step === 'welcome' && <WelcomeStep onNext={goNext} />}
        {step === 'ollama' && (
          <OllamaStep bootstrap={bootstrap} onRefresh={onRefresh} onNext={goNext} onBack={goBack} />
        )}
        {step === 'models' && (
          <ModelsStep
            bootstrap={bootstrap}
            busyAction={busyAction}
            onAction={onAction}
            onNext={goNext}
            onBack={goBack}
          />
        )}
        {step === 'permissions' && (
          <PermissionsStep
            bootstrap={bootstrap}
            busyAction={busyAction}
            onAction={onAction}
            onNext={goNext}
            onBack={goBack}
          />
        )}
        {step === 'ready' && <ReadyStep onBack={goBack} onComplete={onComplete} />}
      </div>
    </main>
  );
}

/* ── Welcome ──────────────────────────────────── */

function WelcomeStep({ onNext }: { onNext: () => void }) {
  return (
    <div className="setup-step setup-step-center">
      <div className="fn-key">
        <span>fn</span>
      </div>
      <h1 className="setup-title serif">Welcome to OpenWhisp</h1>
      <p className="setup-desc">
        Local dictation powered by Whisper and Ollama. Your voice stays on your machine — nothing
        leaves your Mac.
      </p>
      <div className="setup-nav">
        <div />
        <button className="btn btn-primary" onClick={onNext}>
          Get Started
        </button>
      </div>
    </div>
  );
}

/* ── Ollama ───────────────────────────────────── */

function OllamaStep({
  bootstrap,
  onRefresh,
  onNext,
  onBack,
}: {
  bootstrap: BootstrapState;
  onRefresh: () => Promise<BootstrapState>;
  onNext: () => void;
  onBack: () => void;
}) {
  const [checking, setChecking] = useState(false);

  const handleRetry = async () => {
    setChecking(true);
    await onRefresh();
    setChecking(false);
  };

  return (
    <div className="setup-step">
      <h1 className="setup-title serif">Connect to Ollama</h1>
      <p className="setup-desc">
        Ollama runs AI models locally on your Mac. OpenWhisp uses it to enhance your dictated text.
      </p>

      <div className="s-card">
        <div className="s-card-row">
          <div className="s-card-info">
            <strong>Ollama Server</strong>
            <span>{bootstrap.settings.ollamaBaseUrl}</span>
          </div>
          {bootstrap.ollamaReachable ? (
            <span className="badge badge-ready">
              <CheckIcon size={12} /> Connected
            </span>
          ) : (
            <span className="badge badge-pending">Not running</span>
          )}
        </div>

        {!bootstrap.ollamaReachable && (
          <div className="s-card-bottom">
            <p className="s-card-hint">
              Install and start Ollama to continue. It runs locally and is completely free.
            </p>
            <div className="btn-group">
              <button
                className="btn btn-secondary"
                onClick={() =>
                  void window.openWhisp.openExternal('https://ollama.com/download/mac')
                }
              >
                Install Ollama
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => void handleRetry()}
                disabled={checking}
              >
                {checking ? 'Checking...' : 'Retry Connection'}
              </button>
            </div>
          </div>
        )}

        {bootstrap.ollamaReachable && bootstrap.ollamaModels.length > 0 && (
          <div className="s-card-meta">
            {bootstrap.ollamaModels.length} model
            {bootstrap.ollamaModels.length !== 1 ? 's' : ''} available
          </div>
        )}
      </div>

      <div className="setup-nav">
        <button className="btn btn-ghost" onClick={onBack}>
          Back
        </button>
        <button className="btn btn-primary" onClick={onNext} disabled={!bootstrap.ollamaReachable}>
          Continue
        </button>
      </div>
    </div>
  );
}

/* ── Models ───────────────────────────────────── */

function ModelsStep({
  bootstrap,
  busyAction,
  onAction,
  onNext,
  onBack,
}: {
  bootstrap: BootstrapState;
  busyAction: string | null;
  onAction: (label: string, action: () => Promise<BootstrapState>) => Promise<void>;
  onNext: () => void;
  onBack: () => void;
}) {
  const speechReady = bootstrap.speechModelReady;
  const textReady = bootstrap.recommendedModelInstalled;

  return (
    <div className="setup-step">
      <h1 className="setup-title serif">Download Models</h1>
      <p className="setup-desc">
        Two small AI models power OpenWhisp — one for speech recognition and one for text
        enhancement.
      </p>

      <div className="s-card">
        <div className="s-card-label">Speech to Text</div>
        <div className="s-card-row">
          <div className="s-card-info">
            <strong>{RECOMMENDED_WHISPER_LABEL}</strong>
            <span>Local speech recognition</span>
          </div>
          {speechReady ? (
            <span className="badge badge-ready">
              <CheckIcon size={12} /> Ready
            </span>
          ) : (
            <button
              className="btn btn-sm btn-primary"
              disabled={busyAction === 'speech'}
              onClick={() => void onAction('speech', () => window.openWhisp.prepareSpeechModel())}
            >
              {busyAction === 'speech' ? 'Downloading...' : 'Download'}
            </button>
          )}
        </div>
      </div>

      <div className="s-card">
        <div className="s-card-label">Text Enhancement</div>
        <div className="s-card-row">
          <div className="s-card-info">
            <strong>{RECOMMENDED_TEXT_MODEL}</strong>
            <span>Polishes your transcribed text</span>
          </div>
          {textReady ? (
            <span className="badge badge-ready">
              <CheckIcon size={12} /> Ready
            </span>
          ) : (
            <button
              className="btn btn-sm btn-primary"
              disabled={busyAction === 'model' || !bootstrap.ollamaReachable}
              onClick={() =>
                void onAction('model', () => window.openWhisp.pullRecommendedModel())
              }
            >
              {busyAction === 'model' ? 'Downloading...' : 'Download'}
            </button>
          )}
        </div>
      </div>

      <div className="setup-nav">
        <button className="btn btn-ghost" onClick={onBack}>
          Back
        </button>
        <button className="btn btn-primary" onClick={onNext} disabled={!speechReady || !textReady}>
          Continue
        </button>
      </div>
    </div>
  );
}

/* ── Permissions ──────────────────────────────── */

function PermissionsStep({
  bootstrap,
  busyAction,
  onAction,
  onNext,
  onBack,
}: {
  bootstrap: BootstrapState;
  busyAction: string | null;
  onAction: (label: string, action: () => Promise<BootstrapState>) => Promise<void>;
  onNext: () => void;
  onBack: () => void;
}) {
  const micReady = bootstrap.permissions.microphone === 'granted';
  const sysReady =
    bootstrap.permissions.accessibility &&
    bootstrap.permissions.inputMonitoring &&
    bootstrap.permissions.postEvents;

  return (
    <div className="setup-step">
      <h1 className="setup-title serif">Allow Access</h1>
      <p className="setup-desc">
        OpenWhisp needs a few permissions to listen, transcribe, and paste into your apps.
      </p>

      <div className="s-card">
        <div className="s-card-row">
          <div className="s-card-info">
            <strong>Microphone</strong>
            <span>Captures your voice for transcription</span>
          </div>
          {micReady ? (
            <span className="badge badge-ready">
              <CheckIcon size={12} /> Granted
            </span>
          ) : (
            <button
              className="btn btn-sm btn-primary"
              disabled={busyAction === 'mic'}
              onClick={() =>
                void onAction('mic', () => window.openWhisp.requestMicrophoneAccess())
              }
            >
              {busyAction === 'mic' ? 'Requesting...' : 'Allow'}
            </button>
          )}
        </div>

        <div className="s-card-divider" />

        <div className="s-card-row">
          <div className="s-card-info">
            <strong>System Access</strong>
            <span>Fn key listening and auto-paste</span>
          </div>
          {sysReady ? (
            <span className="badge badge-ready">
              <CheckIcon size={12} /> Granted
            </span>
          ) : (
            <button
              className="btn btn-sm btn-primary"
              disabled={busyAction === 'system'}
              onClick={() =>
                void onAction('system', () => window.openWhisp.requestSystemAccess())
              }
            >
              {busyAction === 'system' ? 'Opening...' : 'Allow'}
            </button>
          )}
        </div>
      </div>

      {!sysReady && (
        <p className="setup-hint">
          macOS will ask you to enable Accessibility and Input Monitoring in System Settings. You may
          need to restart the app after granting access.
        </p>
      )}

      <div className="setup-nav">
        <button className="btn btn-ghost" onClick={onBack}>
          Back
        </button>
        <button className="btn btn-primary" onClick={onNext} disabled={!micReady || !sysReady}>
          Continue
        </button>
      </div>
    </div>
  );
}

/* ── Ready ────────────────────────────────────── */

function ReadyStep({ onBack, onComplete }: { onBack: () => void; onComplete: () => void }) {
  return (
    <div className="setup-step setup-step-center">
      <div className="ready-icon">
        <CheckIcon size={32} />
      </div>
      <h1 className="setup-title serif">You're All Set</h1>
      <p className="setup-desc">
        Hold the Fn key to start dictating. Release it and OpenWhisp will transcribe, enhance, and
        paste your text automatically.
      </p>
      <div className="setup-nav">
        <button className="btn btn-ghost" onClick={onBack}>
          Back
        </button>
        <button className="btn btn-primary" onClick={onComplete}>
          Start Dictating
        </button>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────
   Main View – post-setup settings (landscape)
   ──────────────────────────────────────────────── */

function MainView({
  bootstrap,
  status,
  onAction,
}: {
  bootstrap: BootstrapState;
  status: AppStatus;
  onAction: (label: string, action: () => Promise<BootstrapState>) => Promise<void>;
}) {
  const [ollamaUrl, setOllamaUrl] = useState(bootstrap.settings.ollamaBaseUrl);

  useEffect(() => {
    setOllamaUrl(bootstrap.settings.ollamaBaseUrl);
  }, [bootstrap.settings.ollamaBaseUrl]);

  const selectedLevel = LEVEL_OPTIONS.find(
    (l) => l.value === bootstrap.settings.enhancementLevel,
  );

  return (
    <main className="app-shell">
      <div className="drag-region" />

      <header className="app-header">
        <div>
          <h1 className="app-title serif">OpenWhisp</h1>
          <p className="app-tagline serif">Hold Fn to talk. Release to paste.</p>
        </div>
      </header>

      <div className="main-grid">
        {/* Status – full width */}
        <section className="card status-card col-full">
          <div className="status-row">
            <div className={`status-dot status-${status.phase}`} />
            <div className="status-info">
              <strong>{status.title}</strong>
              <span>{status.detail}</span>
            </div>
          </div>
          {status.preview && <pre className="status-preview">{status.preview}</pre>}
        </section>

        {/* Enhancement – left */}
        <section className="card">
          <div className="card-head">
            <h2>Enhancement</h2>
          </div>
          <div className="level-selector">
            {LEVEL_OPTIONS.map((level) => (
              <button
                key={level.value}
                className={`level-pill${bootstrap.settings.enhancementLevel === level.value ? ' level-pill-active' : ''}`}
                onClick={() =>
                  void onAction('settings', () =>
                    window.openWhisp.updateSettings({ enhancementLevel: level.value }),
                  )
                }
              >
                {level.label}
              </button>
            ))}
          </div>
          {selectedLevel && <p className="level-caption">{selectedLevel.caption}</p>}
        </section>

        {/* Models – right */}
        <section className="card">
          <div className="card-head">
            <h2>Models</h2>
            <button
              className="btn btn-link"
              onClick={() =>
                void onAction('refresh-ollama', () => window.openWhisp.refreshOllama())
              }
            >
              Refresh
            </button>
          </div>

          <div className="setting-row">
            <label className="setting-label">Speech model</label>
            <span className="setting-value">{bootstrap.settings.whisperLabel}</span>
          </div>

          <div className="setting-row">
            <label className="setting-label" htmlFor="model-select">
              Rewrite model
            </label>
            <select
              id="model-select"
              className="setting-select"
              value={bootstrap.settings.textModel}
              onChange={(e) =>
                void onAction('settings', () =>
                  window.openWhisp.updateSettings({ textModel: e.target.value }),
                )
              }
            >
              {bootstrap.ollamaModels.length === 0 ? (
                <option value={bootstrap.settings.textModel}>
                  {bootstrap.settings.textModel}
                </option>
              ) : (
                bootstrap.ollamaModels.map((model) => (
                  <option key={model.name} value={model.name}>
                    {model.name} ({formatBytes(model.size)})
                  </option>
                ))
              )}
            </select>
          </div>

          <div className="setting-row">
            <label className="setting-label" htmlFor="ollama-url">
              Ollama URL
            </label>
            <div className="url-field">
              <input
                id="ollama-url"
                className="setting-input"
                value={ollamaUrl}
                onChange={(e) => setOllamaUrl(e.target.value)}
                onBlur={() =>
                  void onAction('settings', () =>
                    window.openWhisp.updateSettings({ ollamaBaseUrl: ollamaUrl }),
                  )
                }
              />
              <span
                className={`url-badge${bootstrap.ollamaReachable ? ' url-badge-ok' : ' url-badge-off'}`}
              >
                {bootstrap.ollamaReachable ? 'Connected' : 'Offline'}
              </span>
            </div>
          </div>
        </section>

        {/* Preferences – full width */}
        <section className="card col-full">
          <div className="card-head">
            <h2>Preferences</h2>
          </div>

          <div className="prefs-grid">
            <ToggleRow
              title="Auto-paste"
              description="Paste into the active app after rewriting"
              checked={bootstrap.settings.autoPaste}
              onChange={(v) =>
                void onAction('settings', () =>
                  window.openWhisp.updateSettings({ autoPaste: v }),
                )
              }
            />
            <ToggleRow
              title="Launch at login"
              description="Start OpenWhisp when you log in"
              checked={bootstrap.settings.launchAtLogin}
              onChange={(v) =>
                void onAction('settings', () =>
                  window.openWhisp.updateSettings({ launchAtLogin: v }),
                )
              }
            />
          </div>

          <div className="storage-section">
            <div className="storage-top">
              <span className="setting-label">Storage</span>
              <div className="btn-group-compact">
                <button
                  className="btn btn-link"
                  onClick={() =>
                    void onAction('storage', () => window.openWhisp.chooseStorage())
                  }
                >
                  Change
                </button>
                <button
                  className="btn btn-link"
                  onClick={() => void window.openWhisp.revealStorage()}
                >
                  Open
                </button>
              </div>
            </div>
            <span className="storage-path">{bootstrap.settings.storageDirectory}</span>
          </div>
        </section>
      </div>

      <div className="app-footer">
        <button
          className="btn btn-link btn-muted"
          onClick={() =>
            void onAction('setup', () =>
              window.openWhisp.updateSettings({ setupComplete: false }),
            )
          }
        >
          Reset Setup
        </button>
      </div>
    </main>
  );
}

/* ────────────────────────────────────────────────
   Toggle Row
   ──────────────────────────────────────────────── */

function ToggleRow({
  title,
  description,
  checked,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="toggle-row">
      <div className="toggle-info">
        <strong>{title}</strong>
        <span>{description}</span>
      </div>
      <label className="switch">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="switch-slider" />
      </label>
    </div>
  );
}

/* ────────────────────────────────────────────────
   Overlay Bar – audio-reactive grid
   ──────────────────────────────────────────────── */

function OverlayBar({ status, audioLevel }: { status: AppStatus; audioLevel: number }) {
  const isListening = status.phase === 'listening';
  const isProcessing =
    status.phase === 'transcribing' ||
    status.phase === 'rewriting' ||
    status.phase === 'pasting';
  const isDone = status.phase === 'done';

  return (
    <div className="overlay-shell">
      <div className={`overlay-bar${isProcessing ? ' overlay-processing' : ''}${isDone ? ' overlay-done' : ''}`}>
        <AudioGrid level={audioLevel} listening={isListening} processing={isProcessing} />
        <span className="overlay-label">{status.title}</span>
      </div>
    </div>
  );
}

function AudioGrid({
  level,
  listening,
  processing,
}: {
  level: number;
  listening: boolean;
  processing: boolean;
}) {
  const [cells, setCells] = useState<boolean[]>(() => new Array(GRID_TOTAL).fill(false));
  const seedRef = useRef(0);

  useEffect(() => {
    if (!listening) {
      if (!processing) setCells(new Array(GRID_TOTAL).fill(false));
      return;
    }

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

    for (let i = 0; i < onCount; i++) {
      next[indices[i]] = true;
    }

    setCells(next);
  }, [level, listening, processing]);

  return (
    <div className={`audio-grid${processing ? ' audio-grid-wave' : ''}`}>
      {cells.map((on, i) => (
        <span
          key={i}
          className={`grid-cell${on ? ' grid-cell-on' : ''}`}
          style={processing ? { animationDelay: `${(i % GRID_COLS) * 0.12}s` } : undefined}
        />
      ))}
    </div>
  );
}
