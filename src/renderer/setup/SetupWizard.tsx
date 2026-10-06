import { useEffect, useState, type ReactNode } from 'react';

import { SETUP_STEPS, type SetupStep } from '../../shared/setup';
import type { AppState, TranscriptionMode } from '../../shared/types';
import { GroqKeyField } from '../components/GroqKeyField';
import { HotkeySettings } from '../components/HotkeyRecorder';
import { Icon } from '../components/Icon';
import { LocalModelPicker } from '../components/LocalModelPicker';
import { LogoImage } from '../components/Logo';
import { PermissionList } from '../components/PermissionList';
import { TryIt } from '../components/TryIt';
import { Button, KeyCap, Notice, Progress, RadioCards } from '../components/ui';
import { useAction } from '../lib/store';

const STEPS = SETUP_STEPS;
type Step = SetupStep;

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
  // Resumes where the user was: granting Input Monitoring can make macOS
  // offer to quit and reopen Yap in the middle of the permissions step.
  const [step, setStep] = useState<Step>(state.settings.setupStep);
  const index = STEPS.indexOf(step);
  const goTo = (target: Step) => {
    setStep(target);
    void window.yap.updateSettings({ setupStep: target }).catch(() => undefined);
  };
  const next = () => goTo(STEPS[Math.min(STEPS.length - 1, index + 1)]);
  const back = () => goTo(STEPS[Math.max(0, index - 1)]);
  const { busy, error, run } = useAction();

  // Leaving early is fine: History lists whatever still needs a fix.
  const leave = (label: string) =>
    run(label, async () => onState(await window.yap.updateSettings({ setupComplete: true, setupStep: 'welcome' })));

  return (
    <main className="setup">
      <div className="titlebar" />
      <div className="setup-top">
        <div className="setup-progress">
          <span>
            Step {index + 1} of {STEPS.length}, {STEP_LABELS[step]}
          </span>
          <Progress value={(index + 1) / STEPS.length} label="Setup progress" />
        </div>
        {step !== 'try' && (
          <Button size="sm" variant="ghost" busy={busy === 'cancel'} onClick={() => void leave('cancel')}>
            Cancel setup
          </Button>
        )}
      </div>

      <div className="setup-panel" key={step}>
        {step === 'welcome' && (
          <div className="setup-welcome">
            <LogoImage className="welcome-logo" size={88} />
            <h1 className="setup-title">Welcome to Yap</h1>
            <p className="setup-lead">
              Hold a key, speak, release. Your words appear wherever you are typing, cleaned up and in well under a second.
            </p>
            <Button variant="primary" size="lg" onClick={next}>
              Set up Yap <Icon name="arrowRight" size={16} />
            </Button>
          </div>
        )}

        {step === 'engine' && <EngineStep state={state} onState={onState} onNext={next} onBack={back} />}

        {step === 'connect' && (
          <div className="setup-body">
            <h1 className="setup-title">{state.settings.transcriptionMode === 'cloud' ? 'Connect Groq' : 'Download a model'}</h1>
            {state.settings.transcriptionMode === 'cloud' ? (
              <>
                <p className="setup-lead">
                  Groq runs open speech and language models on very fast hardware. Not to be confused with Grok, the chatbot.
                </p>
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
            <h1 className="setup-title">Allow access</h1>
            <p className="setup-lead">Yap needs to hear you and to paste into other apps. Each switch updates here live.</p>
            <PermissionList state={state} onState={onState} />
            {state.permissions.nativePermissionsRequired && (
              <p className="setup-hint">
                After you allow Input Monitoring, macOS may offer to quit and reopen Yap. Later is enough: Yap picks up the
                permission without a restart.
              </p>
            )}
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
            <h1 className="setup-title">Pick your key</h1>
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
            <h1 className="setup-title">Try it</h1>
            <TryIt state={state} autoFocus />
            {error && <Notice tone="danger">{error}</Notice>}
            <SetupNav onBack={back}>
              <Button variant="primary" busy={busy === 'finish'} onClick={() => void leave('finish')}>
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
      <h1 className="setup-title">How should Yap transcribe?</h1>
      <p className="setup-lead">You can switch any time under Engine.</p>
      <RadioCards<TranscriptionMode>
        label="Transcription"
        className="choice-grid"
        cardClassName="choice"
        value={mode}
        options={[{ value: 'cloud' }, { value: 'local' }]}
        onChange={(value) => void choose(value)}
        render={(value) =>
          value === 'cloud' ? (
            <>
              <span className="choice-icon">
                <Icon name="cloud" size={20} />
              </span>
              <span className="choice-title">
                Groq cloud <span className="choice-meta">Recommended</span>
              </span>
              <span className="choice-text">
                Fastest and most accurate: Whisper Large v3 answers in a fraction of a second. Free API key, about two hours of
                audio a day.
              </span>
            </>
          ) : (
            <>
              <span className="choice-icon">
                <Icon name="laptop" size={20} />
              </span>
              <span className="choice-title">{localName}</span>
              <span className="choice-text">
                Private and offline: a Whisper model runs on your computer. Slower and less accurate, nothing leaves the device.
              </span>
            </>
          )
        }
      />
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
    <div className={`hotkey-tester${pressed ? ' hotkey-tester-active' : ''}`} role="status" aria-live="polite">
      <KeyCap large pressed={pressed}>
        {state.settings.hotkey.label}
      </KeyCap>
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
