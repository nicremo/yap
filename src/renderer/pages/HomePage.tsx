import type { AppState } from '../../shared/types';
import { CLOUD_MODELS, LOCAL_MODELS } from '../../shared/models';
import type { Page } from '../App';
import { FnKeyNotice } from '../components/HotkeyRecorder';
import { Icon } from '../components/Icon';
import { Button, Card, KeyCap, Notice } from '../components/ui';
import { formatSeconds } from '../lib/store';

const STYLE_LABELS = { conversation: 'Conversation', 'vibe-coding': 'Vibe Coding', 'custom-plus': 'Custom +' } as const;
const LEVEL_LABELS = { none: 'No filter', soft: 'Soft', medium: 'Medium', high: 'High' } as const;

interface Issue {
  key: string;
  text: string;
  action: string;
  page: Page;
}

function findIssues(state: AppState): Issue[] {
  const { permissions, engine, settings } = state;
  const issues: Issue[] = [];

  if (settings.transcriptionMode === 'cloud' && !engine.groqKeySet) {
    issues.push({ key: 'groq', text: 'Add your Groq API key to start dictating.', action: 'Open Engine', page: 'engine' });
  }
  if (settings.transcriptionMode === 'local' && !engine.localModelReady) {
    issues.push({ key: 'local', text: 'Download the local Whisper model to start dictating.', action: 'Open Engine', page: 'engine' });
  }
  if (permissions.microphone === 'denied' || permissions.microphone === 'restricted' || permissions.microphone === 'not-determined') {
    issues.push({ key: 'mic', text: 'Yap cannot use the microphone yet.', action: 'Fix permissions', page: 'settings' });
  }
  if (permissions.nativePermissionsRequired && !permissions.accessibility) {
    issues.push({ key: 'ax', text: 'Accessibility is off, so Yap can copy but not paste.', action: 'Fix permissions', page: 'settings' });
  }
  if (permissions.nativePermissionsRequired && !permissions.hotkeyActive) {
    issues.push({
      key: 'hotkey',
      text: permissions.hotkeyError ?? 'The shortcut listener is not running.',
      action: 'Fix permissions',
      page: 'settings',
    });
  }
  return issues;
}

function engineSummary(state: AppState): { title: string; detail: string } {
  const { settings } = state;
  if (settings.transcriptionMode === 'cloud') {
    const model = CLOUD_MODELS.find((entry) => entry.id === settings.cloudModel)?.label ?? settings.cloudModel;
    return { title: 'Groq cloud', detail: model };
  }
  const model = LOCAL_MODELS.find((entry) => entry.id === settings.localModel)?.label ?? 'Whisper';
  return { title: 'Local', detail: model };
}

export function HomePage({ state, navigate }: { state: AppState; onState: (next: AppState) => void; navigate: (page: Page) => void }) {
  const { status, settings } = state;
  const issues = findIssues(state);
  const engine = engineSummary(state);
  const lastLatency = state.history.find((entry) => entry.status === 'success' && entry.latencyMs)?.latencyMs;
  const today = new Date().toDateString();
  const todayCount = state.history.filter((entry) => entry.status === 'success' && new Date(entry.createdAt).toDateString() === today).length;

  return (
    <>
      <header className="page-header">
        <h1>Home</h1>
      </header>

      <section className="hero">
        <div className="hero-glow" aria-hidden="true" />
        <div className="hero-content">
          <span className="hero-eyebrow">
            <Icon name="zap" size={14} /> {settings.transcriptionMode === 'cloud' ? 'Groq · Whisper Large v3' : 'Private, on this device'}
          </span>
          <h2>
            Hold <KeyCap large>{settings.hotkey.label}</KeyCap> speak, release.
          </h2>
          <p>
            {settings.transcriptionMode === 'cloud'
              ? 'Your words are transcribed in well under a second, polished and pasted where your cursor is.'
              : 'Transcribed right here on your computer. Nothing you say leaves the device.'}
          </p>
        </div>
      </section>

      {issues.length > 0 && (
        <div className="issue-list">
          {issues.map((issue) => (
            <Notice
              key={issue.key}
              tone="warning"
              action={
                <Button size="sm" onClick={() => navigate(issue.page)}>
                  {issue.action}
                </Button>
              }
            >
              {issue.text}
            </Notice>
          ))}
        </div>
      )}
      <FnKeyNotice state={state} />

      <div className="home-grid">
        <Card className="status-card">
          <div className="status-line">
            <span className={`status-dot status-dot-${status.phase}`} />
            <div className="status-text">
              <strong>{status.title}</strong>
              <span>{status.detail || `Hold ${settings.hotkey.label} to dictate.`}</span>
            </div>
          </div>
          {status.preview && <p className="status-preview">{status.preview}</p>}
          {status.metrics && (
            <div className="metrics">
              <span>
                <em>Total</em> {formatSeconds(status.metrics.totalMs)}
              </span>
              <span>
                <em>Transcribe</em> {formatSeconds(status.metrics.transcribeMs)}
              </span>
              {status.metrics.rewriteMs !== null && (
                <span>
                  <em>Polish</em> {formatSeconds(status.metrics.rewriteMs)}
                </span>
              )}
              {status.metrics.uploadBytes !== null && (
                <span>
                  <em>Upload</em> {Math.max(1, Math.round(status.metrics.uploadBytes / 1024))} KB
                </span>
              )}
            </div>
          )}
        </Card>

        <div className="tiles">
          <button type="button" className="tile" onClick={() => navigate('engine')}>
            <span className="tile-label">Engine</span>
            <span className="tile-value">{engine.title}</span>
            <span className="tile-meta">{engine.detail}</span>
          </button>
          <button type="button" className="tile" onClick={() => navigate('style')}>
            <span className="tile-label">Style</span>
            <span className="tile-value">{STYLE_LABELS[settings.styleMode]}</span>
            <span className="tile-meta">{settings.enhancementEnabled ? LEVEL_LABELS[settings.enhancementLevel] : 'Polishing off'}</span>
          </button>
          <button type="button" className="tile" onClick={() => navigate('history')}>
            <span className="tile-label">Today</span>
            <span className="tile-value">{todayCount} {todayCount === 1 ? 'dictation' : 'dictations'}</span>
            <span className="tile-meta">{lastLatency ? `Last one in ${formatSeconds(lastLatency)}` : 'No dictations yet'}</span>
          </button>
        </div>
      </div>
    </>
  );
}
