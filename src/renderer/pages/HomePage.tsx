import { useState } from 'react';

import type { AppState, HistoryEntry } from '../../shared/types';
import type { Page } from '../App';
import { appliedPolish, describeStatus, formatDate, HistoryList } from '../components/HistoryList';
import { FnKeyNotice } from '../components/HotkeyRecorder';
import { HotkeyCap } from '../components/HotkeyCap';
import { Icon } from '../components/Icon';
import { TryIt } from '../components/TryIt';
import { Button, Card, Notice, Segmented } from '../components/ui';
import { describeIssueCount, findIssues, type Issue } from '../lib/issues';
import { POLISH_OPTIONS, polishUpdate, polishValue, type PolishValue } from '../lib/polish';
import { formatSeconds, useAction } from '../lib/store';

/** Typing speed a dictation is compared against for the time it saves. */
const TYPING_WORDS_PER_MINUTE = 40;
const RECENT_COUNT = 5;

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function formatDuration(minutes: number): string {
  if (minutes < 1) return `${Math.round(minutes * 60)} s`;
  if (minutes < 60) return `${Math.round(minutes)} min`;
  return `${Math.floor(minutes / 60)} h ${Math.round(minutes % 60)} min`;
}

/* ── Status line and warnings ──────────────────────────────────────────── */

function statusTitle(state: AppState, issues: Issue[]): string {
  const { status } = state;
  switch (status.phase) {
    case 'listening':
      return status.handsfree ? 'Listening, hands-free…' : 'Listening…';
    case 'transcribing':
    case 'rewriting':
    case 'pasting':
      return 'Transcribing…';
    case 'done':
      return `${status.title}.`;
    case 'error':
      return status.title;
    default:
      if (issues.length === 1) return issues[0].title;
      if (issues.length > 1) return describeIssueCount(issues.length);
      return 'Ready when you are.';
  }
}

function StatusHead({ state, navigate }: { state: AppState; navigate: (page: Page) => void }) {
  const issues = findIssues(state);
  const [showIssues, setShowIssues] = useState(false);
  const idle = state.status.phase === 'idle';
  const single = idle && issues.length === 1 ? issues[0] : null;

  return (
    <header className="status-head">
      <h1 className="status-title" role="status" aria-live="polite">
        {statusTitle(state, issues)}
      </h1>
      {single && (
        <div className="issue-inline">
          <span>{single.detail}</span>
          <Button size="sm" variant="secondary" onClick={() => navigate(single.page)}>
            {single.action}
          </Button>
        </div>
      )}
      <p className="status-sub">
        Hold <HotkeyCap state={state} />. Speak. Release. Double-tap for hands-free.
      </p>
      {idle && issues.length > 1 && (
        <button type="button" className="inline-link issue-toggle" aria-expanded={showIssues} onClick={() => setShowIssues((open) => !open)}>
          {showIssues ? 'Hide' : 'Show what'} <Icon name={showIssues ? 'chevronDown' : 'chevronRight'} size={13} />
        </button>
      )}
      {idle && issues.length > 1 && showIssues && (
        <div className="issue-list">
          {issues.map((issue) => (
            <div key={issue.key} className="issue-row">
              <Icon name="alert" size={16} />
              <div className="issue-text">
                <strong>{issue.title}</strong>
                <span>{issue.detail}</span>
              </div>
              <Button size="sm" variant="secondary" onClick={() => navigate(issue.page)}>
                {issue.action}
              </Button>
            </div>
          ))}
        </div>
      )}
    </header>
  );
}

/* ── Last dictation ────────────────────────────────────────────────────── */

function LastDictation({ entry }: { entry: HistoryEntry }) {
  const [version, setVersion] = useState<'final' | 'raw'>('final');
  const [copied, setCopied] = useState(false);
  const { busy, error, run } = useAction();
  const polished = entry.status === 'success' && entry.rawText !== '' && entry.rawText !== entry.finalText;
  const showing = version === 'raw' && polished ? entry.rawText : entry.finalText;
  const failure = describeStatus(entry.status);

  const copy = () =>
    void navigator.clipboard.writeText(showing).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1_200);
    });

  return (
    <Card className="last-card">
      <div className="last-head">
        <span className="last-label">Last dictation</span>
        {polished && (
          <Segmented<'final' | 'raw'>
            label="Show the text"
            size="sm"
            value={version}
            options={[
              { value: 'final', label: 'Polished' },
              { value: 'raw', label: 'Original' },
            ]}
            onChange={setVersion}
          />
        )}
      </div>

      {entry.status === 'success' ? (
        <p className="last-text">{showing}</p>
      ) : (
        <Notice tone={entry.status === 'transcription-failed' ? 'danger' : 'warning'}>
          {entry.errorMessage ?? (failure?.label === 'Failed' ? 'Transcription failed.' : 'The audio was saved but not transcribed.')}
        </Notice>
      )}
      {error && <Notice tone="danger">{error}</Notice>}

      <div className="last-foot">
        <div className="meta">
          {entry.appName && <span>{entry.appName}</span>}
          <span>{formatDate(entry.createdAt)}</span>
          {entry.status === 'success' && <span>Polish {appliedPolish(entry)}</span>}
          {entry.appRule && <span>App rule for {entry.appRule}</span>}
          {entry.latencyMs !== undefined && <span className="latency">{formatSeconds(entry.latencyMs)}</span>}
        </div>
        <div className="button-row">
          {entry.status === 'success' ? (
            <>
              <Button size="sm" icon={copied ? 'check' : 'copy'} variant="secondary" onClick={copy}>
                {copied ? 'Copied' : 'Copy'}
              </Button>
              <Button
                size="sm"
                icon="paste"
                variant="primary"
                busy={busy === 'paste'}
                title="Hides Yap and pastes into the app behind it"
                onClick={() => void run('paste', () => window.yap.pasteHistoryEntry(entry.id, version === 'raw' && polished ? 'raw' : 'final'))}
              >
                Paste again
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              icon="refresh"
              variant="secondary"
              disabled={!entry.audioFilename}
              busy={busy === 'retry'}
              onClick={() => void run('retry', () => window.yap.retranscribe(entry.id, 'transcribe-and-stylize'))}
            >
              Transcribe again
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

/* ── Statistics and polish ─────────────────────────────────────────────── */

function Stats({ history }: { history: HistoryEntry[] }) {
  const today = new Date().toDateString();
  const succeeded = history.filter((entry) => entry.status === 'success');
  const todays = succeeded.filter((entry) => new Date(entry.createdAt).toDateString() === today);
  const words = todays.reduce((sum, entry) => sum + countWords(entry.finalText), 0);
  // Speed over the most recent dictations, not just today's: one slow
  // morning should not define it.
  const latencies = succeeded
    .slice(0, 20)
    .map((entry) => entry.latencyMs)
    .filter((value): value is number => typeof value === 'number');
  const average = latencies.length > 0 ? latencies.reduce((sum, value) => sum + value, 0) / latencies.length : null;

  return (
    <Card className="stats-card">
      <dl className="stats">
        <div className="stat">
          <dt>Words today</dt>
          <dd>{words.toLocaleString()}</dd>
        </div>
        <div className="stat">
          <dt>Dictations today</dt>
          <dd>{todays.length}</dd>
        </div>
        <div className="stat">
          <dt>Typing time saved</dt>
          <dd>{formatDuration(words / TYPING_WORDS_PER_MINUTE)}</dd>
        </div>
        {average !== null && (
          <div className="stat">
            <dt>Average speed</dt>
            <dd className="mono">{formatSeconds(average)}</dd>
          </div>
        )}
      </dl>
    </Card>
  );
}

function PolishControl({ state, onState }: { state: AppState; onState: (next: AppState) => void }) {
  const { run } = useAction();
  const current = polishValue(state.settings);
  const caption = POLISH_OPTIONS.find((option) => option.value === current)?.caption ?? '';

  return (
    <div className="polish-control">
      <div className="row-text">
        <strong>Polish</strong>
        <span>{state.engine.groqKeySet || current === 'off' ? caption : 'Needs a Groq key, dictations stay as transcribed.'}</span>
      </div>
      <Segmented<PolishValue>
        label="Polish"
        size="sm"
        value={current}
        options={POLISH_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
        onChange={(value) => void run('polish', async () => onState(await window.yap.updateSettings(polishUpdate(value))))}
      />
    </div>
  );
}

export function HomePage({ state, onState, navigate }: { state: AppState; onState: (next: AppState) => void; navigate: (page: Page) => void }) {
  const history = state.history;

  return (
    <>
      <StatusHead state={state} navigate={navigate} />
      <FnKeyNotice state={state} />

      {history.length === 0 ? (
        <Card className="history-empty">
          <TryIt state={state} />
        </Card>
      ) : (
        <>
          <LastDictation key={history[0].id} entry={history[0]} />
          <Stats history={history} />
          <PolishControl state={state} onState={onState} />

          <section className="history-section" aria-label="Recent dictations">
            <div className="history-tools">
              <h2 className="section-title">Recent</h2>
              {history.length > RECENT_COUNT && (
                <button type="button" className="inline-link" onClick={() => navigate('history')}>
                  All {history.length} dictations <Icon name="chevronRight" size={13} />
                </button>
              )}
            </div>
            <HistoryList entries={history.slice(0, RECENT_COUNT)} />
          </section>
        </>
      )}
    </>
  );
}
