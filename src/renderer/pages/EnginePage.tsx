import type { AppState, CloudTranscriptionModel, TranscriptionMode, UpdateSettingsInput } from '../../shared/types';
import { CLOUD_MODELS, DEFAULT_REWRITE_MODEL, findRewriteModel, LANGUAGES, REWRITE_MODELS } from '../../shared/models';
import { GroqKeyField } from '../components/GroqKeyField';
import { Icon } from '../components/Icon';
import { LocalModelPicker } from '../components/LocalModelPicker';
import { Button, Card, Field, Notice, Segmented } from '../components/ui';
import type { Page } from '../App';
import { useT } from '../lib/i18n';
import { useAction } from '../lib/store';

export function EnginePage({
  state,
  onState,
  navigate,
}: {
  state: AppState;
  onState: (next: AppState) => void;
  navigate: (page: Page) => void;
}) {
  const t = useT();
  const { settings, engine } = state;
  const { error, run } = useAction();
  const update = (patch: UpdateSettingsInput) => run('settings', async () => onState(await window.yap.updateSettings(patch)));
  const localName = state.platform === 'darwin' ? t.common.onThisMac : t.common.onThisPC;

  return (
    <>
      <header className="page-header">
        <h1>{t.engine.title}</h1>
        <p>{t.engine.lead}</p>
      </header>
      {error && <Notice tone="danger">{error}</Notice>}

      <Card title="Groq" description={t.engine.groqDescription}>
        <GroqKeyField state={state} onState={onState} />
      </Card>

      <Card title={t.engine.transcription}>
        <Segmented<TranscriptionMode>
          label={t.engine.transcription}
          value={settings.transcriptionMode}
          options={[
            {
              value: 'cloud',
              label: (
                <>
                  <Icon name="cloud" size={15} /> {t.common.groqCloud}
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
            <p className="muted">{t.engine.cloudText}</p>
            {!engine.groqKeySet && <Notice tone="warning">{t.engine.cloudNeedsKey}</Notice>}
            <Field label={t.common.model}>
              <select
                className="select"
                value={settings.cloudModel}
                onChange={(event) => void update({ cloudModel: event.target.value as CloudTranscriptionModel })}
              >
                {CLOUD_MODELS.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label} · {t.modelNotes[model.id]}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        ) : (
          <div className="stack">
            <p className="muted">{t.engine.localText}</p>
            <LocalModelPicker state={state} onState={onState} />
          </div>
        )}

        <Field label={t.engine.language} hint={t.engine.languageHint}>
          <select className="select" value={settings.language} onChange={(event) => void update({ language: event.target.value })}>
            {LANGUAGES.map((language) => (
              <option key={language.code || 'auto'} value={language.code}>
                {language.code ? language.label : t.engine.autoDetect}
              </option>
            ))}
          </select>
        </Field>
      </Card>

      <Card title={t.engine.polishingTitle} description={t.engine.polishingDescription}>
        <RewriteModelField state={state} onChange={(rewriteModel) => void update({ rewriteModel })} />
        {!settings.enhancementEnabled && (
          <Notice
            tone="neutral"
            action={
              <Button size="sm" variant="secondary" onClick={() => navigate('style')}>
                {t.common.openStyle}
              </Button>
            }
          >
            {t.engine.polishingOff}
          </Notice>
        )}
        {settings.enhancementEnabled && settings.transcriptionMode === 'local' && engine.groqKeySet && (
          <Notice tone="neutral">{t.engine.polishingLocal}</Notice>
        )}
      </Card>
    </>
  );
}

function RewriteModelField({ state, onChange }: { state: AppState; onChange: (model: string) => void }) {
  const t = useT();
  const { settings, engine } = state;
  const offered = REWRITE_MODELS.filter((model) => engine.rewriteModelIds.includes(model.id));
  const selected = findRewriteModel(settings.rewriteModel);
  const available = engine.rewriteModelIds.includes(settings.rewriteModel);
  const fallback = findRewriteModel(DEFAULT_REWRITE_MODEL)?.label ?? DEFAULT_REWRITE_MODEL;

  return (
    <>
      <Field label={t.common.model} hint={selected?.preview && available ? t.engine.previewHint(fallback) : undefined}>
        <select className="select" value={settings.rewriteModel} onChange={(event) => onChange(event.target.value)}>
          {offered.map((model) => (
            <option key={model.id} value={model.id}>
              {model.label} · {t.modelNotes[model.id]}
            </option>
          ))}
          {!available && (
            <option value={settings.rewriteModel} disabled>
              {t.engine.unavailableOption(selected?.label ?? settings.rewriteModel)}
            </option>
          )}
        </select>
      </Field>
      {!available && <Notice tone="warning">{t.engine.unavailable(selected?.label ?? settings.rewriteModel, fallback)}</Notice>}
    </>
  );
}
