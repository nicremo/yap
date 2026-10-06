import { useState } from 'react';

import { formatNumber, formatSeconds, type Messages } from '../../shared/i18n';
import type { AppState, HistoryEntry } from '../../shared/types';
import type { Page } from '../App';
import { appliedPolish, formatDate, HistoryList } from '../components/HistoryList';
import { FnKeyNotice } from '../components/HotkeyRecorder';
import { HotkeyCap } from '../components/HotkeyCap';
import { Icon } from '../components/Icon';
import { TryIt } from '../components/TryIt';
import { Button, Card, Notice, Segmented } from '../components/ui';
import { rich, useI18n, useT } from '../lib/i18n';
import { findIssues, type Issue } from '../lib/issues';
import { POLISH_LEVELS, polishUpdate, polishValue, type PolishValue } from '../lib/polish';
import { useAction } from '../lib/store';

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

function statusTitle(state: AppState, issues: Issue[], t: Messages): string {
  const { status } = state;
  switch (status.phase) {
    case 'listening':
      return status.handsfree ? t.home.listeningHandsfree : t.home.listening;
    case 'transcribing':
    case 'rewriting':
    case 'pasting':
      return t.home.transcribing;
    case 'done':
      return `${status.title}.`;
    case 'error':
      return status.title;
    default:
      if (issues.length === 1) return issues[0].title;
      if (issues.length > 1) return t.home.issueCount(issues.length);
      return t.home.ready;
  }
}

function StatusHead({ state, navigate }: { state: AppState; navigate: (page: Page) => void }) {
  const t = useT();
  const issues = findIssues(state, t);
  const [showIssues, setShowIssues] = useState(false);
  const idle = state.status.phase === 'idle';
  const single = idle && issues.length === 1 ? issues[0] : null;

  return (
    <header className="status-head">
      <h1 className="status-title" role="status" aria-live="polite">
        {statusTitle(state, issues, t)}
      </h1>
      {single && (
        <div className="issue-inline">
          <span>{single.detail}</span>
          <Button size="sm" variant="secondary" onClick={() => navigate(single.page)}>
            {single.action}
          </Button>
        </div>
      )}
      <p className="status-sub">{rich(t.home.holdHint, { key: <HotkeyCap state={state} /> })}</p>
      {idle && issues.length > 1 && (
        <button type="button" className="inline-link issue-toggle" aria-expanded={showIssues} onClick={() => setShowIssues((open) => !open)}>
          {showIssues ? t.home.hideIssues : t.home.showIssues} <Icon name={showIssues ? 'chevronDown' : 'chevronRight'} size={13} />
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
  const { locale, t } = useI18n();
  const [version, setVersion] = useState<'final' | 'raw'>('final');
  const [copied, setCopied] = useState(false);
  const { busy, error, run } = useAction();
  const polished = entry.status === 'success' && entry.rawText !== '' && entry.rawText !== entry.finalText;
  const showing = version === 'raw' && polished ? entry.rawText : entry.finalText;

  const copy = () =>
    void navigator.clipboard.writeText(showing).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1_200);
    });

  return (
    <Card className="last-card">
      <div className="last-head">
        <span className="last-label">{t.home.lastDictation}</span>
        {polished && (
          <Segmented<'final' | 'raw'>
            label={t.home.showText}
            size="sm"
            value={version}
            options={[
              { value: 'final', label: t.home.polished },
              { value: 'raw', label: t.home.original },
            ]}
            onChange={setVersion}
          />
        )}
      </div>

      {entry.status === 'success' ? (
        <p className="last-text">{showing}</p>
      ) : (
        <Notice tone={entry.status === 'transcription-failed' ? 'danger' : 'warning'}>
          {entry.errorMessage ?? (entry.status === 'transcription-failed' ? t.home.transcriptionFailed : t.home.notTranscribed)}
        </Notice>
      )}
      {error && <Notice tone="danger">{error}</Notice>}

      <div className="last-foot">
        <div className="meta">
          {entry.appName && <span>{entry.appName}</span>}
          <span>{formatDate(entry.createdAt, locale, t)}</span>
          {entry.status === 'success' && <span>{t.home.polishMeta(appliedPolish(entry, t))}</span>}
          {entry.appRule && <span>{t.home.appRuleFor(entry.appRule)}</span>}
          {entry.latencyMs !== undefined && <span className="latency">{formatSeconds(entry.latencyMs, locale)}</span>}
        </div>
        <div className="button-row">
          {entry.status === 'success' ? (
            <>
              <Button size="sm" icon={copied ? 'check' : 'copy'} variant="secondary" onClick={copy}>
                {copied ? t.common.copied : t.common.copy}
              </Button>
              <Button
                size="sm"
                icon="paste"
                variant="primary"
                busy={busy === 'paste'}
                title={t.home.pasteAgainHint}
                onClick={() => void run('paste', () => window.yap.pasteHistoryEntry(entry.id, version === 'raw' && polished ? 'raw' : 'final'))}
              >
                {t.home.pasteAgain}
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
              {t.home.transcribeAgain}
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

/* ── Statistics and polish ─────────────────────────────────────────────── */

function Stats({ history }: { history: HistoryEntry[] }) {
  const { locale, t } = useI18n();
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
          <dt>{t.home.wordsToday}</dt>
          <dd>{formatNumber(words, locale)}</dd>
        </div>
        <div className="stat">
          <dt>{t.home.dictationsToday}</dt>
          <dd>{formatNumber(todays.length, locale)}</dd>
        </div>
        <div className="stat">
          <dt>{t.home.timeSaved}</dt>
          <dd>{formatDuration(words / TYPING_WORDS_PER_MINUTE)}</dd>
        </div>
        {average !== null && (
          <div className="stat">
            <dt>{t.home.averageSpeed}</dt>
            <dd className="mono">{formatSeconds(average, locale)}</dd>
          </div>
        )}
      </dl>
    </Card>
  );
}

function PolishControl({ state, onState }: { state: AppState; onState: (next: AppState) => void }) {
  const t = useT();
  const { run } = useAction();
  const current = polishValue(state.settings);

  return (
    <div className="polish-control">
      <div className="row-text">
        <strong>{t.home.polish}</strong>
        <span>{state.engine.groqKeySet || current === 'off' ? t.polish.captions[current] : t.home.polishNeedsKey}</span>
      </div>
      <Segmented<PolishValue>
        label={t.home.polish}
        size="sm"
        value={current}
        options={POLISH_LEVELS.map(({ value }) => ({ value, label: t.polish.levels[value] }))}
        onChange={(value) => void run('polish', async () => onState(await window.yap.updateSettings(polishUpdate(value))))}
      />
    </div>
  );
}

export function HomePage({ state, onState, navigate }: { state: AppState; onState: (next: AppState) => void; navigate: (page: Page) => void }) {
  const t = useT();
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

          <section className="history-section" aria-label={t.home.recentLabel}>
            <div className="history-tools">
              <h2 className="section-title">{t.home.recent}</h2>
              {history.length > RECENT_COUNT && (
                <button type="button" className="inline-link" onClick={() => navigate('history')}>
                  {t.home.allDictations(history.length)} <Icon name="chevronRight" size={13} />
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
