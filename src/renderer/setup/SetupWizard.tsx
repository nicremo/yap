import { useEffect, useState, type ReactNode } from 'react';

import { hotkeyLabel } from '../../shared/hotkeys';
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
import { rich, useT } from '../lib/i18n';
import { useAction } from '../lib/store';

const STEPS = SETUP_STEPS;
type Step = SetupStep;

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
  const t = useT();
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
          <span>{t.setup.progress(index + 1, STEPS.length, t.setup.steps[step])}</span>
          <Progress value={(index + 1) / STEPS.length} label={t.setup.progressLabel} />
        </div>
        {step !== 'try' && (
          <Button size="sm" variant="ghost" busy={busy === 'cancel'} onClick={() => void leave('cancel')}>
            {t.setup.cancel}
          </Button>
        )}
      </div>

      <div className="setup-panel" key={step}>
        {step === 'welcome' && (
          <div className="setup-welcome">
            <LogoImage className="welcome-logo" size={88} />
            <h1 className="setup-title">{t.setup.welcomeTitle}</h1>
            <p className="setup-lead">{t.setup.welcomeLead}</p>
            <Button variant="primary" size="lg" onClick={next}>
              {t.setup.start} <Icon name="arrowRight" size={16} />
            </Button>
          </div>
        )}

        {step === 'engine' && <EngineStep state={state} onState={onState} onNext={next} onBack={back} />}

        {step === 'connect' && (
          <div className="setup-body">
            <h1 className="setup-title">{state.settings.transcriptionMode === 'cloud' ? t.setup.connectGroq : t.setup.downloadModel}</h1>
            {state.settings.transcriptionMode === 'cloud' ? (
              <>
                <p className="setup-lead">{t.setup.groqLead}</p>
                <ol className="howto">
                  <li>
                    {rich(t.setup.groqStepOpen, {
                      link: (
                        <button type="button" className="inline-link" onClick={() => void window.yap.openExternal('https://console.groq.com/keys')}>
                          console.groq.com/keys
                        </button>
                      ),
                    })}
                  </li>
                  <li>{t.setup.groqStepCreate}</li>
                  <li>{t.setup.groqStepPaste}</li>
                </ol>
                <GroqKeyField state={state} onState={onState} />
              </>
            ) : (
              <>
                <p className="setup-lead">{t.setup.localLead}</p>
                <LocalModelPicker state={state} onState={onState} />
              </>
            )}
            <SetupNav onBack={back}>
              <Button variant="primary" onClick={next} disabled={!engineReady(state)}>
                {t.common.continue}
              </Button>
            </SetupNav>
          </div>
        )}

        {step === 'permissions' && (
          <div className="setup-body">
            <h1 className="setup-title">{t.setup.permissionsTitle}</h1>
            <p className="setup-lead">{t.setup.permissionsLead}</p>
            <PermissionList state={state} onState={onState} />
            {state.permissions.nativePermissionsRequired && <p className="setup-hint">{t.setup.reopenHint}</p>}
            <SetupNav onBack={back}>
              {!permissionsReady(state) && (
                <Button variant="ghost" onClick={next}>
                  {t.setup.skip}
                </Button>
              )}
              <Button variant="primary" onClick={next} disabled={!permissionsReady(state)}>
                {t.common.continue}
              </Button>
            </SetupNav>
          </div>
        )}

        {step === 'shortcut' && (
          <div className="setup-body">
            <h1 className="setup-title">{t.setup.shortcutTitle}</h1>
            <p className="setup-lead">{t.setup.shortcutLead}</p>
            <HotkeySettings state={state} onSave={(hotkey) => void run('hotkey', async () => onState(await window.yap.updateSettings({ hotkey })))} />
            <HotkeyTester state={state} />
            <SetupNav onBack={back}>
              <Button variant="primary" onClick={next}>
                {t.common.continue}
              </Button>
            </SetupNav>
          </div>
        )}

        {step === 'try' && (
          <div className="setup-body">
            <h1 className="setup-title">{t.setup.tryTitle}</h1>
            <TryIt state={state} autoFocus />
            {error && <Notice tone="danger">{error}</Notice>}
            <SetupNav onBack={back}>
              <Button variant="primary" busy={busy === 'finish'} onClick={() => void leave('finish')}>
                {t.setup.finish}
              </Button>
            </SetupNav>
          </div>
        )}
      </div>
    </main>
  );
}

function SetupNav({ onBack, children }: { onBack: () => void; children: ReactNode }) {
  const t = useT();
  return (
    <div className="setup-nav">
      <Button variant="ghost" onClick={onBack}>
        {t.common.back}
      </Button>
      <div className="button-row">{children}</div>
    </div>
  );
}

function EngineStep({ state, onState, onNext, onBack }: { state: AppState; onState: (next: AppState) => void; onNext: () => void; onBack: () => void }) {
  const t = useT();
  const { busy, error, run } = useAction();
  const mode = state.settings.transcriptionMode;
  const localName = state.platform === 'darwin' ? t.common.onThisMac : t.common.onThisPC;

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
      <h1 className="setup-title">{t.setup.engineTitle}</h1>
      <p className="setup-lead">{t.setup.engineLead}</p>
      <RadioCards<TranscriptionMode>
        label={t.engine.transcription}
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
                {t.common.groqCloud} <span className="choice-meta">{t.setup.recommended}</span>
              </span>
              <span className="choice-text">{t.setup.cloudChoice}</span>
            </>
          ) : (
            <>
              <span className="choice-icon">
                <Icon name="laptop" size={20} />
              </span>
              <span className="choice-title">{localName}</span>
              <span className="choice-text">{t.setup.localChoice}</span>
            </>
          )
        }
      />
      {error && <Notice tone="danger">{error}</Notice>}
      <SetupNav onBack={onBack}>
        <Button variant="primary" busy={busy === 'mode'} onClick={onNext}>
          {t.common.continue}
        </Button>
      </SetupNav>
    </div>
  );
}

function HotkeyTester({ state }: { state: AppState }) {
  const t = useT();
  const label = hotkeyLabel(state.settings.hotkey, t.keys);
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
        {label}
      </KeyCap>
      <span>{!state.permissions.hotkeyActive ? t.setup.testerInactive : seen ? t.setup.testerSeen : t.setup.testerPress(label)}</span>
      {seen && <Icon name="check" size={18} strokeWidth={2.5} />}
    </div>
  );
}
