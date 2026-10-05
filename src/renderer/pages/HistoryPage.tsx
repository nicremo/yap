import { useState } from 'react';

import type { AppState, DictationStatus, HistoryEntry, RetranscribeMode } from '../../shared/types';
import { Icon } from '../components/Icon';
import { Button, Card, Chip, Notice, type Tone } from '../components/ui';
import { formatSeconds, useAction } from '../lib/store';
import { LEVEL_LABELS, STYLE_LABELS } from '../lib/style-content';

const DAY_MS = 24 * 60 * 60 * 1000;

function audioCountdown(entry: HistoryEntry): string {
  const expires = entry.audioExpiresAt
    ? new Date(entry.audioExpiresAt).getTime()
    : new Date(entry.createdAt).getTime() + 7 * DAY_MS;
  const remaining = expires - Date.now();
  if (remaining <= 0) return 'audio expired';
  const days = Math.floor(remaining / DAY_MS);
  return days >= 1 ? `audio ${days}d` : `audio ${Math.max(1, Math.round(remaining / 3_600_000))}h`;
}

function describeStatus(status: DictationStatus): { label: string; tone: Tone } {
  if (status === 'success') return { label: 'Transcribed', tone: 'success' };
  if (status === 'transcription-failed') return { label: 'Failed', tone: 'danger' };
  return { label: 'Audio only', tone: 'warning' };
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (date.toDateString() === now.toDateString()) return `Today ${time}`;
  if (date.toDateString() === yesterday.toDateString()) return `Yesterday ${time}`;
  return `${date.toLocaleDateString([], { day: 'numeric', month: 'short' })} ${time}`;
}

export function HistoryPage({ state }: { state: AppState }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const { busy, error, run } = useAction();
  const history = state.history;

  const copy = (id: string, text: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(id);
      setTimeout(() => setCopied((current) => (current === id ? null : current)), 1_200);
    });
  };

  const retranscribe = (entry: HistoryEntry, mode: RetranscribeMode) =>
    run(`retranscribe:${entry.id}`, () => window.yap.retranscribe(entry.id, mode));

  return (
    <>
      <header className="page-header">
        <h1>History</h1>
        <p>Every dictation, newest first. Recordings are kept for seven days so you can transcribe them again.</p>
      </header>
      {error && <Notice tone="danger">{error}</Notice>}

      <Card
        title="Recent dictations"
        action={
          history.length > 0 && (
            <Button size="sm" variant="ghost" icon="trash" busy={busy === 'clear'} onClick={() => void run('clear', () => window.yap.clearHistory())}>
              Clear all
            </Button>
          )
        }
      >
        {history.length === 0 ? (
          <p className="empty">Nothing here yet. Hold {state.settings.hotkey.label} and say something.</p>
        ) : (
          <ul className="history-list">
            {history.map((entry) => {
              const isOpen = expanded === entry.id;
              const status = describeStatus(entry.status);
              const hasAudio = Boolean(entry.audioFilename);
              const working = busy === `retranscribe:${entry.id}`;
              const headline =
                entry.finalText ||
                entry.rawText ||
                (entry.status === 'transcription-failed' ? entry.errorMessage ?? 'Transcription failed.' : 'Audio saved, not transcribed yet.');

              return (
                <li key={entry.id} className={`history-item${isOpen ? ' history-item-open' : ''}${entry.status !== 'success' ? ' history-item-flagged' : ''}`}>
                  <button type="button" className="history-summary" onClick={() => setExpanded(isOpen ? null : entry.id)}>
                    <span className="history-text">{headline}</span>
                    <span className="history-meta">
                      <span>{formatDate(entry.createdAt)}</span>
                      {entry.appName && <span>{entry.appName}</span>}
                      {entry.latencyMs !== undefined && <span className="mono">{formatSeconds(entry.latencyMs)}</span>}
                      {entry.status !== 'success' && <Chip tone={status.tone}>{status.label}</Chip>}
                    </span>
                    <Icon name="chevronDown" size={16} className="history-chevron" />
                  </button>

                  {isOpen && (
                    <div className="history-detail">
                      {entry.rawText && entry.rawText !== entry.finalText && (
                        <div className="raw-block">
                          <span className="field-label">Raw transcript</span>
                          <p>{entry.rawText}</p>
                        </div>
                      )}
                      {entry.errorMessage && <Notice tone={entry.status === 'success' ? 'neutral' : 'danger'}>{entry.errorMessage}</Notice>}
                      <div className="history-facts">
                        <span>{STYLE_LABELS[entry.styleMode] ?? entry.styleMode} · {LEVEL_LABELS[entry.enhancementLevel] ?? entry.enhancementLevel}</span>
                        {entry.transcriptionSource && <span>{entry.transcriptionSource === 'cloud' ? 'Groq' : 'Local'}</span>}
                        <span>{hasAudio ? audioCountdown(entry) : 'audio expired'}</span>
                      </div>
                      <div className="history-actions">
                        <Button size="sm" variant="primary" icon={copied === entry.id ? 'check' : 'copy'} disabled={!entry.finalText} onClick={() => copy(entry.id, entry.finalText)}>
                          {copied === entry.id ? 'Copied' : 'Copy'}
                        </Button>
                        {entry.rawText && entry.rawText !== entry.finalText && (
                          <Button size="sm" onClick={() => copy(`${entry.id}:raw`, entry.rawText)}>
                            {copied === `${entry.id}:raw` ? 'Copied' : 'Copy raw'}
                          </Button>
                        )}
                        <Button size="sm" icon="refresh" disabled={!hasAudio} busy={working} onClick={() => void retranscribe(entry, 'transcribe-only')}>
                          Transcribe again
                        </Button>
                        <Button size="sm" icon="sparkles" disabled={!hasAudio} busy={working} onClick={() => void retranscribe(entry, 'transcribe-and-stylize')}>
                          Transcribe + polish
                        </Button>
                        <Button size="sm" variant="ghost" icon="folder" disabled={!hasAudio} onClick={() => void run('reveal', () => window.yap.revealAudio(entry.id))}>
                          Show audio
                        </Button>
                        <Button size="sm" variant="ghost" icon="trash" onClick={() => void run('remove', () => window.yap.removeHistoryEntry(entry.id))}>
                          Delete
                        </Button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
