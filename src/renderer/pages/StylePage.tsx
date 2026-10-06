import { useMemo, useState } from 'react';

import type { AppState, CustomPlusVoice, RuleLevel, StyleMode, UpdateSettingsInput } from '../../shared/types';
import type { Page } from '../App';
import { Icon } from '../components/Icon';
import { InfoTip, Tooltip } from '../components/Tooltip';
import { Button, Card, Notice, RadioCards, Segmented } from '../components/ui';
import { useT } from '../lib/i18n';
import { POLISH_LEVELS, polishUpdate, polishValue, type PolishValue } from '../lib/polish';
import { useAction } from '../lib/store';
import { exampleFor, STYLE_MODES } from '../lib/style-content';

/** The built-in rules cover thirty developer tools; a few are enough to see the pattern. */
const COLLAPSED_RULES = 6;

/** Off is the bar below the grid, the four levels sit above it. */
const POLISH_ORDER: ReadonlyArray<{ value: PolishValue; className?: string }> = [
  { value: 'none' },
  { value: 'soft' },
  { value: 'medium' },
  { value: 'high' },
  { value: 'off', className: 'level-card-off' },
];

interface SelectProps<T> {
  value: T;
  onChange: (value: T) => void;
  label: string;
  /** Set by a wrapping Tooltip. */
  'aria-describedby'?: string;
}

function StyleSelect({ value, onChange, label, ...rest }: SelectProps<StyleMode>) {
  const t = useT();
  return (
    <select
      className="select select-sm"
      aria-label={label}
      aria-describedby={rest['aria-describedby']}
      value={value}
      onChange={(event) => onChange(event.target.value as StyleMode)}
    >
      {STYLE_MODES.map((style) => (
        <option key={style} value={style}>
          {t.style.names[style]}
        </option>
      ))}
    </select>
  );
}

/** A rule picks a level for its app, or Off to leave that app unpolished. */
function LevelSelect({ value, onChange, label, ...rest }: SelectProps<RuleLevel>) {
  const t = useT();
  return (
    <select
      className="select select-sm"
      aria-label={label}
      aria-describedby={rest['aria-describedby']}
      value={value}
      onChange={(event) => onChange(event.target.value as RuleLevel)}
    >
      {POLISH_LEVELS.map(({ value: level }) => (
        <option key={level} value={level}>
          {t.polish.levels[level]}
        </option>
      ))}
    </select>
  );
}

function AppRules({ state }: { state: AppState }) {
  const t = useT();
  const { error, run } = useAction();
  const [adding, setAdding] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const rules = showAll ? state.appRules : state.appRules.slice(0, COLLAPSED_RULES);
  const [app, setApp] = useState('');
  const [style, setStyle] = useState<StyleMode>('conversation');
  const [level, setLevel] = useState<RuleLevel>('medium');

  // Apps Yap has dictated into, newest first, that have no rule yet.
  const candidates = useMemo(() => {
    const ruled = new Set(state.appRules.map((rule) => rule.appIdentifier));
    const seen = new Map<string, string>();
    for (const entry of state.history) {
      if (entry.appBundleId && entry.appName && !ruled.has(entry.appBundleId) && entry.appBundleId !== 'ai.yap.desktop') {
        if (!seen.has(entry.appBundleId)) seen.set(entry.appBundleId, entry.appName);
      }
    }
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  }, [state.appRules, state.history]);

  const chosen = candidates.find((candidate) => candidate.id === app) ?? candidates[0];

  const add = () =>
    run('add', async () => {
      if (!chosen) return;
      await window.yap.addAppRule({ appIdentifier: chosen.id, label: chosen.name, styleMode: style, enhancementLevel: level });
      setApp('');
      setAdding(false);
    });

  const addButton = (
    <Tooltip text={t.rules.addTip} align="end">
      <Button size="sm" variant="secondary" icon="plus" onClick={() => setAdding(true)} disabled={adding}>
        {t.rules.addRule}
      </Button>
    </Tooltip>
  );

  return (
    <Card
      title={
        <>
          {t.rules.title}
          <InfoTip label={t.rules.about} text={t.rules.aboutTip} />
        </>
      }
      description={t.rules.description}
      action={state.appRules.length > 0 ? addButton : undefined}
    >
      <ul className="explainer">
        {t.rules.explainer.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {error && <Notice tone="danger">{error}</Notice>}
      {state.appRules.length === 0 && !adding ? (
        <div className="row">
          <span className="muted">{t.rules.none}</span>
          {addButton}
        </div>
      ) : (
        <div className="rule-list">
          {rules.map((rule) => (
            <div key={rule.appIdentifier} className="rule-row">
              <span className="rule-name">{rule.label}</span>
              <Tooltip text={t.rules.styleTip(rule.label)}>
                <StyleSelect
                  label={t.rules.styleFor(rule.label)}
                  value={rule.styleMode}
                  onChange={(styleMode) => void run('rule', () => window.yap.updateAppRule(rule.appIdentifier, styleMode, rule.enhancementLevel))}
                />
              </Tooltip>
              <Tooltip text={t.rules.polishTip(rule.label)}>
                <LevelSelect
                  label={t.rules.polishFor(rule.label)}
                  value={rule.enhancementLevel}
                  onChange={(enhancementLevel) => void run('rule', () => window.yap.updateAppRule(rule.appIdentifier, rule.styleMode, enhancementLevel))}
                />
              </Tooltip>
              <Tooltip text={t.rules.removeTip(rule.label)} align="end">
                <button
                  type="button"
                  className="icon-button"
                  aria-label={t.rules.removeFor(rule.label)}
                  onClick={() => void run('rule', () => window.yap.removeAppRule(rule.appIdentifier))}
                >
                  <Icon name="x" size={14} />
                </button>
              </Tooltip>
            </div>
          ))}
          {state.appRules.length > COLLAPSED_RULES && (
            <button type="button" className="inline-link rule-more" onClick={() => setShowAll((value) => !value)}>
              {showAll ? t.rules.showFewer : t.rules.showAll(state.appRules.length)}
            </button>
          )}
        </div>
      )}

      {adding &&
        (candidates.length === 0 ? (
          <div className="rule-add">
            <span className="muted">{t.rules.noCandidates}</span>
            <span />
            <span />
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
              {t.common.close}
            </Button>
          </div>
        ) : (
          <form
            className="rule-add"
            onSubmit={(event) => {
              event.preventDefault();
              void add();
            }}
          >
            <select className="select select-sm" aria-label={t.rules.app} value={chosen?.id ?? ''} onChange={(event) => setApp(event.target.value)}>
              {candidates.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </option>
              ))}
            </select>
            <StyleSelect label={t.rules.newStyle} value={style} onChange={setStyle} />
            <LevelSelect label={t.rules.newPolish} value={level} onChange={setLevel} />
            <div className="button-row">
              <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
                {t.common.cancel}
              </Button>
              <Button size="sm" variant="primary" type="submit">
                {t.common.add}
              </Button>
            </div>
          </form>
        ))}
    </Card>
  );
}

export function StylePage({ state, onState, navigate }: { state: AppState; onState: (next: AppState) => void; navigate: (page: Page) => void }) {
  const t = useT();
  const { settings } = state;
  const { error, run } = useAction();
  const update = (patch: UpdateSettingsInput) => run('settings', async () => onState(await window.yap.updateSettings(patch)));

  const polish = polishValue(settings);
  const custom = settings.styleMode === 'custom-plus';
  const example = exampleFor(settings.styleMode, settings.customPlusVoice, polish, t);

  return (
    <>
      <header className="page-header">
        <h1>{t.style.title}</h1>
        <p>{t.style.lead}</p>
      </header>
      {error && <Notice tone="danger">{error}</Notice>}

      <Card title={t.polish.label}>
        <div className="stack">
          {!state.engine.groqKeySet && polish !== 'off' && (
            <Notice
              tone="warning"
              action={
                <Button size="sm" variant="secondary" onClick={() => navigate('engine')}>
                  {t.common.openEngine}
                </Button>
              }
            >
              {t.style.needsKey}
            </Notice>
          )}
          <RadioCards<PolishValue>
            label={t.polish.label}
            className="level-grid"
            cardClassName="level-card"
            value={polish}
            options={POLISH_ORDER}
            onChange={(value) => void update(polishUpdate(value))}
            render={(value) => {
              const label = t.polish.levels[value];
              if (value === 'off') {
                return (
                  <>
                    <strong>{label}</strong>
                    <span className="level-caption">{t.style.offCaption}</span>
                  </>
                );
              }
              const intensity = POLISH_LEVELS.find((level) => level.value === value)?.intensity ?? 0;
              return (
                <>
                  <span className="level-card-top">
                    <strong>{label}</strong>
                    <span className="intensity" aria-hidden="true">
                      {[1, 2, 3, 4].map((step) => (
                        <i key={step} className={step <= intensity ? 'on' : ''} />
                      ))}
                    </span>
                  </span>
                  <span className="level-caption">{custom ? t.style.customCaptions[value] : t.polish.captions[value]}</span>
                </>
              );
            }}
          />
          <dl className="example" aria-label={t.style.exampleLabel(t.polish.levels[polish])}>
            <dt>{t.style.youSay}</dt>
            <dd>{example.spoken}</dd>
            <dt>{t.style.yapWrites}</dt>
            <dd className="example-after">{example.written}</dd>
          </dl>
        </div>
      </Card>

      <Card title={t.style.writingStyle}>
        <div className="stack">
          <div className="style-row">
            <Segmented<StyleMode>
              label={t.style.writingStyle}
              value={settings.styleMode}
              options={STYLE_MODES.map((style) => ({ value: style, label: t.style.names[style] }))}
              onChange={(styleMode) => void update({ styleMode })}
            />
            {custom && (
              <>
                <span className="field-label">{t.style.base}</span>
                <Segmented<CustomPlusVoice>
                  label={t.style.baseVoice}
                  value={settings.customPlusVoice}
                  options={[
                    { value: 'conversation', label: t.style.voices.conversation },
                    { value: 'developer', label: t.style.voices.developer },
                  ]}
                  onChange={(customPlusVoice) => void update({ customPlusVoice })}
                />
              </>
            )}
          </div>
          <p className="style-description">{t.style.descriptions[settings.styleMode]}</p>
        </div>
      </Card>

      <AppRules state={state} />
    </>
  );
}
