import { useEffect, useRef, useState, type ReactNode } from 'react';

import type { AppState, TranscriptionMode } from '../../shared/types';
import { GroqKeyField } from '../components/GroqKeyField';
import { HotkeySettings } from '../components/HotkeyRecorder';
import { Icon } from '../components/Icon';
import { LocalModelPicker } from '../components/LocalModelPicker';
import { LogoTile } from '../components/Logo';
import { PermissionList } from '../components/PermissionList';
import { Button, Chip, KeyCap, Notice } from '../components/ui';
import { formatSeconds, useAction } from '../lib/store';

const STEPS = ['welcome', 'engine', 'connect', 'permissions', 'shortcut', 'try'] as const;
type Step = (typeof STEPS)[number];

const STEP_LABELS: Record<Step, string> = {
  welcome: 'Welcome',
  engine: 'Engine',
  connect: 'Connect',
  permissions: 'Access',
  shortcut: 'Shortcut',
  try: 'Try it',
};

function permissionsReady(state: AppState): boolean {
  const { permissions } = state;
  const micReady = permissions.microphone === 'granted' || permissions.microphone === 'unknown';
  if (!permissions.nativePermissionsRequired) return micReady;
  return micReady && permissions.accessibility && permissions.hotkeyActive;
}

function engineReady(state: AppState): boolean {
  return state.settings.transcriptionMode === 'cloud' ? state.engine.groqKeySet : state.engine.localModelReady;
}

export function SetupWizard({ state, onState }: { state: AppState; onState: (next: AppState) => void }) {
  const [step, setStep] = useState<Step>('welcome');
  const index = STEPS.indexOf(step);
  const next = () => setStep(STEPS[Math.min(STEPS.length - 1, index + 1)]);
  const back = () => setStep(STEPS[Math.max(0, index - 1)]);
  const { busy, error, run } = useAction();

  const finish = () => run('finish', async () => onState(await window.yap.updateSettings({ setupComplete: true })));

  return (
    <main className="setup">
      <div className="titlebar" />
      <ol className="setup-steps">
        {STEPS.map((item, position) => (
          <li key={item} className={position < index ? 'done' : position === index ? 'current' : ''}>
            <span className="setup-step-dot">{position < index ? <Icon name="check" size={11} strokeWidth={3} /> : position + 1}</span>
            <span className="setup-step-label">{STEP_LABELS[item]}</span>
          </li>
        ))}
      </ol>

      <div className="setup-panel" key={step}>
        {step === 'welcome' && (
          <div className="setup-welcome">
            <LogoTile size={76} />
            <h1>Welcome to Yap</h1>
            <p>Hold a key, speak, release. Your words appear wherever you are typing, cleaned up and in well under a second.</p>
            <Button variant="primary" size="lg" onClick={next}>
              Set up Yap <Icon name="arrowRight" size={16} />
            </Button>
          </div>
        )}

        {step === 'engine' && <EngineStep state={state} onState={onState} onNext={next} onBack={back} />}

        {step === 'connect' && (
          <div className="setup-body">
            <h1>{state.settings.transcriptionMode === 'cloud' ? 'Connect Groq' : 'Download a model'}</h1>
            {state.settings.transcriptionMode === 'cloud' ? (
              <>
                <ol className="howto">
                  <li>
                    Open{' '}
                    <button type="button" className="inline-link" onClick={() => void window.yap.openExternal('https://console.groq.com/keys')}>
                      console.groq.com/keys
                    </button>{' '}
                    and sign in, it is free.
                  </li>
                  <li>Create an API key and copy it.</li>
                  <li>Paste it below. Yap checks it right away and stores it in your system keychain.</li>
                </ol>
                <GroqKeyField state={state} onState={onState} />
              </>
            ) : (
              <>
                <p className="setup-lead">The model is downloaded once and then runs entirely on this computer.</p>
                <LocalModelPicker state={state} onState={onState} />
              </>
            )}
            <SetupNav onBack={back}>
              <Button variant="primary" onClick={next} disabled={!engineReady(state)}>
                Continue
              </Button>
            </SetupNav>
          </div>
        )}

        {step === 'permissions' && (
          <div className="setup-body">
            <h1>Allow access</h1>
            <p className="setup-lead">Yap needs to hear you and to paste into other apps. Each switch updates here live.</p>
            <PermissionList state={state} onState={onState} />
            <SetupNav onBack={back}>
              {!permissionsReady(state) && (
                <Button variant="ghost" onClick={next}>
                  Skip for now
                </Button>
              )}
              <Button variant="primary" onClick={next} disabled={!permissionsReady(state)}>
                Continue
              </Button>
            </SetupNav>
          </div>
        )}

        {step === 'shortcut' && (
          <div className="setup-body">
            <h1>Pick your key</h1>
            <p className="setup-lead">Hold it while you talk. Tap it twice to dictate hands-free, tap once more to finish.</p>
            <HotkeySettings state={state} onSave={(hotkey) => void run('hotkey', async () => onState(await window.yap.updateSettings({ hotkey })))} />
            <HotkeyTester state={state} />
            <SetupNav onBack={back}>
              <Button variant="primary" onClick={next}>
                Continue
              </Button>
            </SetupNav>
          </div>
        )}

        {step === 'try' && (
          <div className="setup-body">
            <h1>Try it</h1>
            <TryIt state={state} />
            {error && <Notice tone="danger">{error}</Notice>}
            <SetupNav onBack={back}>
              <Button variant="primary" busy={busy === 'finish'} onClick={() => void finish()}>
                Start using Yap
              </Button>
            </SetupNav>
          </div>
        )}
      </div>
    </main>
  );
}

function SetupNav({ onBack, children }: { onBack: () => void; children: ReactNode }) {
  return (
    <div className="setup-nav">
      <Button variant="ghost" onClick={onBack}>
        Back
      </Button>
      <div className="button-row">{children}</div>
    </div>
  );
}

function EngineStep({ state, onState, onNext, onBack }: { state: AppState; onState: (next: AppState) => void; onNext: () => void; onBack: () => void }) {
  const { busy, error, run } = useAction();
  const mode = state.settings.transcriptionMode;
  const localName = state.platform === 'darwin' ? 'On this Mac' : 'On this PC';

  const choose = (transcriptionMode: TranscriptionMode) =>
    run('mode', async () =>
      onState(
        await window.yap.updateSettings({
          transcriptionMode,
          // Local means private: polishing would send the text to Groq, so it
          // starts switched off there and on for the cloud.
          enhancementEnabled: transcriptionMode === 'cloud',
        }),
      ),
    );

  return (
    <div className="setup-body">
      <h1>How should Yap transcribe?</h1>
      <p className="setup-lead">You can switch any time in Engine settings.</p>
      <div className="choice-grid">
        <button type="button" className={`choice choice-large${mode === 'cloud' ? ' choice-active' : ''}`} onClick={() => void choose('cloud')}>
          <span className="choice-icon">
            <Icon name="cloud" size={22} />
          </span>
          <span className="choice-title">
            Groq cloud <Chip tone="accent">Recommended</Chip>
          </span>
          <span className="choice-text">
            Fastest and most accurate: Whisper Large v3 answers in a fraction of a second. Free API key, about two hours
            of audio a day.
          </span>
        </button>
        <button type="button" className={`choice choice-large${mode === 'local' ? ' choice-active' : ''}`} onClick={() => void choose('local')}>
          <span className="choice-icon">
            <Icon name="laptop" size={22} />
          </span>
          <span className="choice-title">{localName}</span>
          <span className="choice-text">
            Private and offline: a Whisper model runs on your computer. Slower and less accurate, nothing leaves the
            device.
          </span>
        </button>
      </div>
      {error && <Notice tone="danger">{error}</Notice>}
      <SetupNav onBack={onBack}>
        <Button variant="primary" busy={busy === 'mode'} onClick={onNext}>
          Continue
        </Button>
      </SetupNav>
    </div>
  );
}

function HotkeyTester({ state }: { state: AppState }) {
  const [pressed, setPressed] = useState(false);
  const [seen, setSeen] = useState(false);

  useEffect(
    () =>
      window.yap.onHotkeyActivity((down) => {
        setPressed(down);
        if (down) setSeen(true);
      }),
    [],
  );

  return (
    <div className={`hotkey-tester${pressed ? ' hotkey-tester-active' : ''}${seen ? ' hotkey-tester-seen' : ''}`}>
      <KeyCap large>{state.settings.hotkey.label}</KeyCap>
      <span>
        {!state.permissions.hotkeyActive
          ? 'The shortcut listener is not running yet. Check the access step.'
          : seen
            ? 'Yap sees your key.'
            : `Press ${state.settings.hotkey.label} to test it.`}
      </span>
      {seen && <Icon name="check" size={18} strokeWidth={2.5} />}
    </div>
  );
}

function TryIt({ state }: { state: AppState }) {
  const [text, setText] = useState('');
  const area = useRef<HTMLTextAreaElement>(null);
  const { status, settings } = state;

  useEffect(() => {
    area.current?.focus();
  }, []);

  return (
    <div className="try-it">
      <p className="setup-lead">
        Click into the box, hold <KeyCap>{settings.hotkey.label}</KeyCap>, say a sentence and let go.
      </p>
      <textarea
        ref={area}
        className="input try-area"
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="Your words land here…"
      />
      <div className="try-status">
        <span className={`status-dot status-dot-${status.phase}`} />
        <span>
          <strong>{status.title}</strong> {status.detail}
        </span>
        {status.phase === 'done' && status.metrics && <Chip tone="success">{formatSeconds(status.metrics.totalMs)}</Chip>}
      </div>
    </div>
  );
}
