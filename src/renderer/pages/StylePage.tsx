import type { AppState, CustomPlusVoice, EnhancementLevel, StyleMode } from '../../shared/types';
import { Card, Chip, Notice, Segmented } from '../components/ui';
import { useAction } from '../lib/store';
import {
  LEGACY_EXAMPLES,
  LEVEL_LABELS,
  LEVEL_OPTIONS,
  PLUS_EXAMPLES,
  PLUS_LEVEL_CAPTIONS,
  STYLE_LABELS,
  STYLE_TABS,
} from '../lib/style-content';

export function StylePage({ state, onState }: { state: AppState; onState: (next: AppState) => void }) {
  const { settings } = state;
  const { error, run } = useAction();
  const activeTab = STYLE_TABS.find((tab) => tab.value === settings.styleMode) ?? STYLE_TABS[0];
  const voice = settings.customPlusVoice;

  const update = (patch: Parameters<typeof window.yap.updateSettings>[0]) =>
    run('settings', async () => onState(await window.yap.updateSettings(patch)));

  const exampleFor = (level: EnhancementLevel) =>
    activeTab.value === 'custom-plus'
      ? PLUS_EXAMPLES[voice][level]
      : LEGACY_EXAMPLES[activeTab.value === 'vibe-coding' ? 'vibe-coding' : 'conversation'][level];

  const updateRule = (appIdentifier: string, styleMode: StyleMode, level: EnhancementLevel) =>
    run('rule', async () => {
      await window.yap.updateAppRule(appIdentifier, styleMode, level);
    });

  return (
    <>
      <header className="page-header">
        <h1>Style</h1>
        <p>How your dictation gets polished. App rules switch the style automatically per app.</p>
      </header>

      {!settings.enhancementEnabled && (
        <Notice tone="neutral">Polishing is switched off in Engine, so dictations are pasted as transcribed.</Notice>
      )}
      {error && <Notice tone="danger">{error}</Notice>}

      <Segmented<StyleMode>
        value={settings.styleMode}
        options={STYLE_TABS.map((tab) => ({ value: tab.value, label: tab.label }))}
        onChange={(styleMode) => void update({ styleMode })}
      />
      <p className="style-description">{activeTab.description}</p>

      {activeTab.value === 'custom-plus' && (
        <div className="voice-row">
          <span className="field-label">Voice</span>
          <Segmented<CustomPlusVoice>
            value={voice}
            options={[
              { value: 'conversation', label: 'Conversation' },
              { value: 'developer', label: 'Developer' },
            ]}
            onChange={(customPlusVoice) => void update({ customPlusVoice })}
          />
        </div>
      )}

      <div className="level-grid">
        {LEVEL_OPTIONS.map((level) => {
          const active = settings.enhancementLevel === level.value;
          return (
            <button
              key={level.value}
              type="button"
              className={`level-card${active ? ' level-card-active' : ''}`}
              onClick={() => void update({ enhancementLevel: level.value })}
            >
              <span className="level-card-top">
                <strong>{level.label}</strong>
                <span className="intensity">
                  {[1, 2, 3, 4].map((step) => (
                    <i key={step} className={step <= level.intensity ? 'on' : ''} />
                  ))}
                </span>
              </span>
              <span className="level-caption">
                {activeTab.value === 'custom-plus' ? PLUS_LEVEL_CAPTIONS[level.value] : level.caption}
              </span>
              <span className="level-example">“{exampleFor(level.value)}”</span>
            </button>
          );
        })}
      </div>

      <Card
        title={
          <>
            App rules <Chip>{state.appRules.length}</Chip>
          </>
        }
        description="These apps get their own style and level. Everything else uses the default above."
      >
        {state.appRules.length === 0 ? (
          <p className="empty">No app rules yet.</p>
        ) : (
          <div className="rule-list">
            {state.appRules.map((rule) => (
              <div key={rule.appIdentifier} className="rule-row">
                <span className="rule-name">{rule.label}</span>
                <select
                  className="select select-sm"
                  value={rule.styleMode}
                  onChange={(event) => void updateRule(rule.appIdentifier, event.target.value as StyleMode, rule.enhancementLevel)}
                >
                  {Object.entries(STYLE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <select
                  className="select select-sm"
                  value={rule.enhancementLevel}
                  onChange={(event) =>
                    void updateRule(rule.appIdentifier, rule.styleMode, event.target.value as EnhancementLevel)
                  }
                >
                  {Object.entries(LEVEL_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Remove ${rule.label}`}
                  onClick={() => void run('rule', async () => window.yap.removeAppRule(rule.appIdentifier))}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
