import type { AppState, CloudTranscriptionModel, TranscriptionMode, UpdateSettingsInput } from '../../shared/types';
import { CLOUD_MODELS, DEFAULT_REWRITE_MODEL, findRewriteModel, LANGUAGES, REWRITE_MODELS } from '../../shared/models';
import { GroqKeyField } from '../components/GroqKeyField';
import { Icon } from '../components/Icon';
import { LocalModelPicker } from '../components/LocalModelPicker';
import { Card, Field, Notice, Segmented, ToggleRow } from '../components/ui';
import { useAction } from '../lib/store';

export function EnginePage({ state, onState }: { state: AppState; onState: (next: AppState) => void }) {
  const { settings, engine } = state;
  const { error, run } = useAction();
  const update = (patch: UpdateSettingsInput) => run('settings', async () => onState(await window.yap.updateSettings(patch)));
  const localName = state.platform === 'darwin' ? 'On this Mac' : 'On this PC';

  return (
    <>
      <header className="page-header">
        <h1>Engine</h1>
        <p>Where your voice turns into text, and how it gets polished.</p>
      </header>
      {error && <Notice tone="danger">{error}</Notice>}

      <Card title="Groq" description="One free key powers cloud transcription and text polishing.">
        <GroqKeyField state={state} onState={onState} />
      </Card>

      <Card title="Transcription">
        <Segmented<TranscriptionMode>
          label="Transcription"
          value={settings.transcriptionMode}
          options={[
            {
              value: 'cloud',
              label: (
                <>
                  <Icon name="cloud" size={15} /> Cloud (Groq)
                </>
              ),
            },
            {
              value: 'local',
              label: (
                <>
                  <Icon name="laptop" size={15} /> {localName}
                </>
              ),
            },
          ]}
          onChange={(transcriptionMode) => void update({ transcriptionMode })}
        />

        {settings.transcriptionMode === 'cloud' ? (
          <div className="stack">
            <p className="muted">
              Whisper runs on Groq's hardware and answers in a fraction of a second. The free tier covers about two
              hours of audio a day.
            </p>
            {!engine.groqKeySet && <Notice tone="warning">Add a Groq key above to use cloud transcription.</Notice>}
            <Field label="Model">
              <select
                className="select"
                value={settings.cloudModel}
                onChange={(event) => void update({ cloudModel: event.target.value as CloudTranscriptionModel })}
              >
                {CLOUD_MODELS.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label} · {model.note}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        ) : (
          <div className="stack">
            <p className="muted">
              Whisper runs on this computer. Nothing you say leaves the device, at the cost of speed and accuracy.
            </p>
            <LocalModelPicker state={state} onState={onState} />
          </div>
        )}

        <Field label="Language" hint="Setting your language skips detection: faster and more accurate.">
          <select className="select" value={settings.language} onChange={(event) => void update({ language: event.target.value })}>
            {LANGUAGES.map((language) => (
              <option key={language.code || 'auto'} value={language.code}>
                {language.label}
              </option>
            ))}
          </select>
        </Field>
      </Card>

      <Card title="Text enhancement">
        <ToggleRow
          title="Polish with AI"
          description={
            engine.groqKeySet
              ? 'Removes fillers, fixes grammar and applies your style. Adds a few hundred milliseconds.'
              : 'Needs a Groq key. Without it, dictations are pasted exactly as transcribed.'
          }
          checked={settings.enhancementEnabled}
          onChange={(enhancementEnabled) => void update({ enhancementEnabled })}
        />
        {settings.enhancementEnabled && <RewriteModelField state={state} onChange={(rewriteModel) => void update({ rewriteModel })} />}
        {settings.enhancementEnabled && settings.transcriptionMode === 'local' && engine.groqKeySet && (
          <Notice tone="neutral">Polishing sends the transcribed text to Groq. Turn it off to keep everything local.</Notice>
        )}
      </Card>
    </>
  );
}

function RewriteModelField({ state, onChange }: { state: AppState; onChange: (model: string) => void }) {
  const { settings, engine } = state;
  const offered = REWRITE_MODELS.filter((model) => engine.rewriteModelIds.includes(model.id));
  const selected = findRewriteModel(settings.rewriteModel);
  const available = engine.rewriteModelIds.includes(settings.rewriteModel);
  const fallback = findRewriteModel(DEFAULT_REWRITE_MODEL)?.label ?? DEFAULT_REWRITE_MODEL;

  return (
    <>
      <Field
        label="Model"
        hint={
          selected?.preview && available
            ? `Preview models can change or disappear at short notice. Yap falls back to ${fallback} when this one is gone.`
            : undefined
        }
      >
        <select className="select" value={settings.rewriteModel} onChange={(event) => onChange(event.target.value)}>
          {offered.map((model) => (
            <option key={model.id} value={model.id}>
              {model.label} · {model.note}
            </option>
          ))}
          {!available && (
            <option value={settings.rewriteModel} disabled>
              {selected?.label ?? settings.rewriteModel} (not available)
            </option>
          )}
        </select>
      </Field>
      {!available && (
        <Notice tone="warning">
          {selected?.label ?? settings.rewriteModel} is not available for your Groq key right now. {fallback} polishes your
          dictations until it is back.
        </Notice>
      )}
    </>
  );
}
