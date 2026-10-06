import { useMemo, useState } from 'react';

import type { AppState, CustomPlusVoice, RuleLevel, StyleMode, UpdateSettingsInput } from '../../shared/types';
import type { Page } from '../App';
import { Icon } from '../components/Icon';
import { InfoTip, Tooltip } from '../components/Tooltip';
import { Button, Card, Notice, RadioCards, Segmented } from '../components/ui';
import { POLISH_OPTIONS, polishLabel, polishUpdate, polishValue, type PolishValue } from '../lib/polish';
import { useAction } from '../lib/store';
import { CUSTOM_CAPTIONS, exampleFor, STYLE_LABELS, STYLE_TABS, VOICE_LABELS } from '../lib/style-content';

/** The built-in rules cover thirty developer tools; a few are enough to see the pattern. */
const COLLAPSED_RULES = 6;

/** A rule picks a level for its app, or Off to leave that app unpolished. */
const RULE_LEVELS: ReadonlyArray<{ value: RuleLevel; label: string }> = POLISH_OPTIONS.map((option) => ({
  value: option.value,
  label: option.label,
}));

/** Off is the bar below the grid, the four levels sit above it. */
const POLISH_ORDER: ReadonlyArray<{ value: PolishValue; className?: string }> = [
  { value: 'none' },
  { value: 'soft' },
  { value: 'medium' },
  { value: 'high' },
  { value: 'off', className: 'level-card-off' },
];

const OFF_CAPTION = 'Nothing is polished: every dictation goes out exactly as transcribed, also in apps with a rule.';

interface SelectProps<T> {
  value: T;
  onChange: (value: T) => void;
  label: string;
  /** Set by a wrapping Tooltip. */
  'aria-describedby'?: string;
}

function StyleSelect({ value, onChange, label, ...rest }: SelectProps<StyleMode>) {
  return (
    <select
      className="select select-sm"
      aria-label={label}
      aria-describedby={rest['aria-describedby']}
      value={value}
      onChange={(event) => onChange(event.target.value as StyleMode)}
    >
      {Object.entries(STYLE_LABELS).map(([style, name]) => (
        <option key={style} value={style}>
          {name}
        </option>
      ))}
    </select>
  );
}

function LevelSelect({ value, onChange, label, ...rest }: SelectProps<RuleLevel>) {
  return (
    <select
      className="select select-sm"
      aria-label={label}
      aria-describedby={rest['aria-describedby']}
      value={value}
      onChange={(event) => onChange(event.target.value as RuleLevel)}
    >
      {RULE_LEVELS.map((level) => (
        <option key={level.value} value={level.value}>
          {level.label}
        </option>
      ))}
    </select>
  );
}

function AppRules({ state }: { state: AppState }) {
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
    <Tooltip text="Give an app you have dictated into its own writing style and polish." align="end">
      <Button size="sm" variant="secondary" icon="plus" onClick={() => setAdding(true)} disabled={adding}>
        Add rule
      </Button>
    </Tooltip>
  );

  return (
    <Card
      title={
        <>
          App rules
          <InfoTip
            label="About app rules"
            text="When you finish a dictation, Yap checks which app has the focus. If that app has a rule, its writing style and polish replace the settings above for that dictation."
          />
        </>
      }
      description="Different apps want different writing: exact words in a terminal, careful prose in mail. A rule gives one app its own style and polish."
      action={state.appRules.length > 0 ? addButton : undefined}
    >
      <ul className="explainer">
        <li>A rule applies to the app you are in when you let go of the key, wherever the dictation started.</li>
        <li>Off in a rule leaves that app unpolished. Off at the top of this page turns polishing off everywhere, rules included.</li>
        <li>Yap comes with rules for common developer tools. History shows which rule a dictation used.</li>
      </ul>
      {error && <Notice tone="danger">{error}</Notice>}
      {state.appRules.length === 0 && !adding ? (
        <div className="row">
          <span className="muted">No app rules yet.</span>
          {addButton}
        </div>
      ) : (
        <div className="rule-list">
          {rules.map((rule) => (
            <div key={rule.appIdentifier} className="rule-row">
              <span className="rule-name">{rule.label}</span>
              <Tooltip text={`The writing style for dictations into ${rule.label}.`}>
                <StyleSelect
                  label={`Style for ${rule.label}`}
                  value={rule.styleMode}
                  onChange={(styleMode) => void run('rule', () => window.yap.updateAppRule(rule.appIdentifier, styleMode, rule.enhancementLevel))}
                />
              </Tooltip>
              <Tooltip text={`How much Yap polishes in ${rule.label}. Off keeps your exact words.`}>
                <LevelSelect
                  label={`Polish for ${rule.label}`}
                  value={rule.enhancementLevel}
                  onChange={(enhancementLevel) => void run('rule', () => window.yap.updateAppRule(rule.appIdentifier, rule.styleMode, enhancementLevel))}
                />
              </Tooltip>
              <Tooltip text={`Remove the rule. ${rule.label} then uses the settings above.`} align="end">
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Remove the rule for ${rule.label}`}
                  onClick={() => void run('rule', () => window.yap.removeAppRule(rule.appIdentifier))}
                >
                  <Icon name="x" size={14} />
                </button>
              </Tooltip>
            </div>
          ))}
          {state.appRules.length > COLLAPSED_RULES && (
            <button type="button" className="inline-link rule-more" onClick={() => setShowAll((value) => !value)}>
              {showAll ? 'Show fewer' : `Show all ${state.appRules.length} rules`}
            </button>
          )}
        </div>
      )}

      {adding &&
        (candidates.length === 0 ? (
          <div className="rule-add">
            <span className="muted">Dictate into an app once, then it can get a rule here.</span>
            <span />
            <span />
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
              Close
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
            <select className="select select-sm" aria-label="App" value={chosen?.id ?? ''} onChange={(event) => setApp(event.target.value)}>
              {candidates.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </option>
              ))}
            </select>
            <StyleSelect label="Style for the new rule" value={style} onChange={setStyle} />
            <LevelSelect label="Polish for the new rule" value={level} onChange={setLevel} />
            <div className="button-row">
              <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
                Cancel
              </Button>
              <Button size="sm" variant="primary" type="submit">
                Add
              </Button>
            </div>
          </form>
        ))}
    </Card>
  );
}

export function StylePage({ state, onState, navigate }: { state: AppState; onState: (next: AppState) => void; navigate: (page: Page) => void }) {
  const { settings } = state;
  const { error, run } = useAction();
  const update = (patch: UpdateSettingsInput) => run('settings', async () => onState(await window.yap.updateSettings(patch)));

  const polish = polishValue(settings);
  const tab = STYLE_TABS.find((candidate) => candidate.value === settings.styleMode) ?? STYLE_TABS[0];
  const custom = settings.styleMode === 'custom-plus';
  const example = exampleFor(settings.styleMode, settings.customPlusVoice, polish);

  return (
    <>
      <header className="page-header">
        <h1>Style</h1>
        <p>How much Yap reworks what you say, and in which voice.</p>
      </header>
      {error && <Notice tone="danger">{error}</Notice>}

      <Card title="Polish">
        <div className="stack">
          {!state.engine.groqKeySet && polish !== 'off' && (
            <Notice
              tone="warning"
              action={
                <Button size="sm" variant="secondary" onClick={() => navigate('engine')}>
                  Open Engine
                </Button>
              }
            >
              Polishing runs on Groq and needs a key. Until then dictations go out as transcribed.
            </Notice>
          )}
          <RadioCards<PolishValue>
            label="Polish"
            className="level-grid"
            cardClassName="level-card"
            value={polish}
            options={POLISH_ORDER}
            onChange={(value) => void update(polishUpdate(value))}
            render={(value) => {
              const option = POLISH_OPTIONS.find((candidate) => candidate.value === value)!;
              if (value === 'off') {
                return (
                  <>
                    <strong>{option.label}</strong>
                    <span className="level-caption">{OFF_CAPTION}</span>
                  </>
                );
              }
              return (
                <>
                  <span className="level-card-top">
                    <strong>{option.label}</strong>
                    <span className="intensity" aria-hidden="true">
                      {[1, 2, 3, 4].map((step) => (
                        <i key={step} className={step <= option.intensity ? 'on' : ''} />
                      ))}
                    </span>
                  </span>
                  <span className="level-caption">{custom ? CUSTOM_CAPTIONS[value] : option.caption}</span>
                </>
              );
            }}
          />
          <dl className="example" aria-label={`Example at ${polishLabel(polish)}`}>
            <dt>You say</dt>
            <dd>{example.spoken}</dd>
            <dt>Yap writes</dt>
            <dd className="example-after">{example.written}</dd>
          </dl>
        </div>
      </Card>

      <Card title="Writing style">
        <div className="stack">
          <div className="style-row">
            <Segmented<StyleMode>
              label="Writing style"
              value={settings.styleMode}
              options={STYLE_TABS.map((candidate) => ({ value: candidate.value, label: candidate.label }))}
              onChange={(styleMode) => void update({ styleMode })}
            />
            {custom && (
              <>
                <span className="field-label">Base</span>
                <Segmented<CustomPlusVoice>
                  label="Base voice"
                  value={settings.customPlusVoice}
                  options={[
                    { value: 'conversation', label: VOICE_LABELS.conversation },
                    { value: 'developer', label: VOICE_LABELS.developer },
                  ]}
                  onChange={(customPlusVoice) => void update({ customPlusVoice })}
                />
              </>
            )}
          </div>
          <p className="style-description">{tab.description}</p>
        </div>
      </Card>

      <AppRules state={state} />
    </>
  );
}
